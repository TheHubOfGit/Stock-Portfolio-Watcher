import sys
import pandas as pd
import numpy as np
import yfinance as yf
import os
import json
from datetime import datetime, timedelta, timezone
from flask import Flask, jsonify, send_from_directory, request
import time
import random
import concurrent.futures

# --- Configuration ---
app = Flask(__name__, static_folder='../frontend', static_url_path='')

# Define symbols and their types (including BTC and LTC)
ASSET_LIST = {
    'BA': 'Stock', 'ABNB': 'Stock', 'SHOP': 'Stock', 'WDAY': 'Stock', 'SWBI': 'Stock',
    'COIN': 'Stock', 'QCOM': 'Stock', 'AMD': 'Stock', 'NVDA': 'Stock', 'PLTR': 'Stock',
    'EQIX': 'Stock', 'DIS': 'Stock', 'PFE': 'Stock', 'PSEC': 'Stock', 'TSLA': 'Stock',
    'MSFT': 'Stock', 'GOOG': 'Stock', 'AMZN': 'Stock', 'AAPL': 'Stock', 'V': 'Stock',
    'UAL': 'Stock', 'DAL': 'Stock', 'NOW': 'Stock', 'CRM': 'Stock', 'DUK': 'Stock',
    'GEV': 'Stock', 'CEG': 'Stock', 'PM': 'Stock',
    'SOXX': 'ETF', 'SPXL': 'ETF', 'TQQQ': 'ETF', 'XAR': 'ETF', 
    'BTC-USD': 'Crypto', 'LTC-USD': 'Crypto'
}
SYMBOLS = list(ASSET_LIST.keys())

# Define Market Symbols and Names
MARKET_SYMBOLS = {
    'SPY': 'SPY',
    '^DJI': 'Dow Jones',
    '^GSPC': 'S&P 500',
    '^VIX': 'VIX (Volatility)'
}

# Use a longer period for EMA/RSI calculation stability if needed
DATA_FETCH_PERIOD = "5y" # Fetch 5 years of data for calculations

# Maximum attempts to fetch data from yfinance
MAX_RETRY_ATTEMPTS = 3
RETRY_DELAY_BASE = 1  # Base delay in seconds between retries

# --- Calculation Logic ---

def calculate_indicators(df):
    """Calculates EMA13, EMA21, EMA50, EMA100, EMA200, and RSI14 for a given DataFrame."""
    if df.empty or 'Close' not in df.columns:
        return pd.DataFrame({'EMA13': [], 'EMA21': [], 'EMA50': [], 'EMA100': [], 'EMA200': [], 'RSI14': []})

    result = pd.DataFrame(index=df.index)
    close_series = df['Close'].astype(float)

    result['EMA13'] = close_series.ewm(span=13, adjust=False).mean()
    result['EMA21'] = close_series.ewm(span=21, adjust=False).mean()
    result['EMA50'] = close_series.ewm(span=50, adjust=False).mean()
    result['EMA100'] = close_series.ewm(span=100, adjust=False).mean()
    result['EMA200'] = close_series.ewm(span=200, adjust=False).mean()

    delta = close_series.diff()
    gain = delta.where(delta > 0, 0.0)
    loss = -delta.where(delta < 0, 0.0)
    avg_gain = gain.ewm(com=13, adjust=False).mean()
    avg_loss = loss.ewm(com=13, adjust=False).mean()
    rs = avg_gain / avg_loss
    result['RSI14'] = 100.0 - (100.0 / (1.0 + rs.replace(np.inf, np.nan)))
    result['RSI14'] = result['RSI14'].fillna(50)

    return result[['EMA13', 'EMA21', 'EMA50', 'EMA100', 'EMA200', 'RSI14']]

# --- Helper Function for Time Periods ---
def get_start_date_from_period(period_str, reference_date=None):
    """Converts period string (e.g., '1y', '3m', '1d') to a start date relative to the reference date."""
    if reference_date is None:
        reference_date = datetime.now(timezone.utc)
    # Ensure reference_date is timezone-aware (UTC)
    if reference_date.tzinfo is None:
        reference_date = reference_date.replace(tzinfo=timezone.utc)
    else:
        reference_date = reference_date.astimezone(timezone.utc)

    period_map = {
        '1d': timedelta(days=1), # Added 1d
        '1w': timedelta(weeks=1), '7d': timedelta(days=7), '1m': timedelta(days=30),
        '3m': timedelta(days=91), '6m': timedelta(days=182), '1y': timedelta(days=365),
        '2y': timedelta(days=365*2), '3y': timedelta(days=365*3),
        '4y': timedelta(days=365*4), '5y': timedelta(days=365*5),
    }
    delta = period_map.get(period_str.lower())
    # Default to 1 day if period is invalid or not found
    return reference_date - delta if delta else reference_date - timedelta(days=1)

# --- Calculation Logic (Modified Drawdown) ---
def calculate_current_drawdown_from_peak(full_close_prices, period_start_date):
    """Calculates the drawdown from the peak within the period to the current price."""
    if full_close_prices.empty: return None
    if full_close_prices.index.tz is None:
        close_prices_utc = full_close_prices.tz_localize('UTC')
    else:
        close_prices_utc = full_close_prices.tz_convert('UTC')
    period_prices = close_prices_utc[close_prices_utc.index >= period_start_date]
    if period_prices.empty: return None
    period_peak = period_prices.max()
    latest_price = full_close_prices.iloc[-1]
    if pd.isna(period_peak) or period_peak == 0: return None
    return ((latest_price - period_peak) / period_peak) * 100

def calculate_period_change(close_prices, period_str='1d'):
    """Calculates the percentage change over a specified period."""
    if close_prices.empty or len(close_prices) < 2: return 0.0

    latest_price = close_prices.iloc[-1]
    latest_date = close_prices.index[-1]

    # Ensure latest_date is timezone-aware for comparison
    if latest_date.tzinfo is None:
        latest_date = latest_date.tz_localize('UTC')
    else:
        latest_date = latest_date.astimezone(timezone.utc)

    start_date = get_start_date_from_period(period_str, reference_date=latest_date)

    # Ensure the index is timezone-aware (UTC) for comparison
    if close_prices.index.tz is None:
        close_prices_index_utc = close_prices.index.tz_localize('UTC')
    else:
        close_prices_index_utc = close_prices.index.tz_convert('UTC')

    # Find the closest available price at or before the start date using the UTC index
    historical_prices = close_prices[close_prices_index_utc <= start_date]
    if historical_prices.empty:
        # If no data before start date, use the earliest available price
        historical_price = close_prices.iloc[0]
        if historical_price == 0 or pd.isna(historical_price): return 0.0 # Avoid division by zero or NaN
    else:
        historical_price = historical_prices.iloc[-1]
        if historical_price == 0 or pd.isna(historical_price): return 0.0 # Avoid division by zero or NaN

    if pd.isna(latest_price): return 0.0 # Avoid calculation with NaN

    return ((latest_price - historical_price) / historical_price) * 100

def calculate_cumulative_return(close_prices, period_str='1y'):
    """Calculates the cumulative percentage return series over a specified period."""
    if close_prices.empty or len(close_prices) < 2:
        return pd.Series(dtype=float) # Return empty series if not enough data

    latest_date = close_prices.index[-1]
    # Ensure latest_date is timezone-aware for comparison
    if latest_date.tzinfo is None: latest_date = latest_date.tz_localize('UTC')
    else: latest_date = latest_date.astimezone(timezone.utc)

    start_date = get_start_date_from_period(period_str, reference_date=latest_date)

    # Ensure the index is timezone-aware (UTC) for comparison
    if close_prices.index.tz is None: close_prices_index_utc = close_prices.index.tz_localize('UTC')
    else: close_prices_index_utc = close_prices.index.tz_convert('UTC')

    # Filter data for the period
    period_prices = close_prices[close_prices_index_utc >= start_date]

    if period_prices.empty:
        return pd.Series(dtype=float) # Return empty series if no data in period

    # Calculate cumulative return relative to the first price in the period
    cumulative_return = (period_prices / period_prices.iloc[0] - 1) * 100
    return cumulative_return.dropna()

# --- Helper function to find last crossover date ---
def find_last_ema_bullish_crossover_date(ema_short_series, ema_long_series):
    """Finds the date index of the last bullish crossover (short > long)."""
    if ema_short_series.empty or ema_long_series.empty or len(ema_short_series) < 2: return None
    combined_emas = pd.DataFrame({'short': ema_short_series, 'long': ema_long_series}).dropna()
    if len(combined_emas) < 2: return None
    currently_above = combined_emas['short'] > combined_emas['long']
    previously_below_or_equal = combined_emas['short'].shift(1) <= combined_emas['long'].shift(1)
    crossover_points = combined_emas[currently_above & previously_below_or_equal]
    if crossover_points.empty: return None
    last_crossover_date = crossover_points.index[-1]
    return last_crossover_date.strftime('%Y-%m-%d') if isinstance(last_crossover_date, pd.Timestamp) else str(last_crossover_date)

def find_last_ema_bearish_crossover_date(ema_short_series, ema_long_series):
    """Finds the date index of the last bearish crossover (short < long)."""
    if ema_short_series.empty or ema_long_series.empty or len(ema_short_series) < 2: return None
    combined_emas = pd.DataFrame({'short': ema_short_series, 'long': ema_long_series}).dropna()
    if len(combined_emas) < 2: return None
    currently_below = combined_emas['short'] < combined_emas['long']
    previously_above_or_equal = combined_emas['short'].shift(1) >= combined_emas['long'].shift(1)
    crossover_points = combined_emas[currently_below & previously_above_or_equal]
    if crossover_points.empty: return None
    last_crossover_date = crossover_points.index[-1]
    return last_crossover_date.strftime('%Y-%m-%d') if isinstance(last_crossover_date, pd.Timestamp) else str(last_crossover_date)

def _process_symbol_data(symbol, stock_data_raw, drawdown_period_str, change_period_str, spy_1y_change, is_market_symbol=False):
    """Processes a DataFrame for a single symbol to calculate all indicators and metrics."""
    try:
        # The core processing logic starts here
        stock_data = stock_data_raw[['Open', 'High', 'Low', 'Close', 'Volume']].copy()

        if stock_data['Close'].isna().all() or len(stock_data['Close'].dropna()) < 2:
            return {'name': symbol, 'display_name': MARKET_SYMBOLS.get(symbol, symbol), 'error': "No valid Close prices for processing."}

        indicators = calculate_indicators(stock_data)
        combined_data = stock_data.join(indicators)
        if combined_data.empty or len(combined_data) < 2 or 'Close' not in combined_data.columns: 
            return {'name': symbol, 'display_name': MARKET_SYMBOLS.get(symbol, symbol), 'error': "Insufficient data after processing"}

        latest_row = combined_data.iloc[-1]
        close_prices = combined_data['Close'].dropna()
        
        latest_price_val = float(latest_row['Close'])

        if is_market_symbol:
            print(f"--- Market Symbol Process End: {symbol} ---")

        result_dict = {
            'name': symbol,
            'display_name': MARKET_SYMBOLS.get(symbol, symbol),
            'type': MARKET_SYMBOLS.get(symbol) or ASSET_LIST.get(symbol, 'Unknown'),
            'latest_price': latest_price_val,
            'daily_change_pct': calculate_period_change(close_prices, change_period_str),
            'ema13': float(latest_row['EMA13']) if pd.notna(latest_row['EMA13']) else None,
            'ema21': float(latest_row['EMA21']) if pd.notna(latest_row['EMA21']) else None,
            'rsi14': float(latest_row['RSI14']) if pd.notna(latest_row['RSI14']) else None,
            'ema50': float(latest_row['EMA50']) if pd.notna(latest_row['EMA50']) else None,
            'ema100': float(latest_row['EMA100']) if pd.notna(latest_row['EMA100']) else None,
            'ema200': float(latest_row['EMA200']) if pd.notna(latest_row['EMA200']) else None,
            'current_drawdown_pct': calculate_current_drawdown_from_peak(close_prices, get_start_date_from_period(drawdown_period_str)),
            'ema_signal': None,
            'ema_long_signal': None,
            'ema_short_last_signal_date': None,
            'ema_long_last_signal_date': None,
            'last_updated': datetime.now(timezone.utc).isoformat(),
            'relative_perf_1y': None,
            'sparkline_data': None,
            'asset_1y_history_dates': [],
            'asset_1y_history_values': [],
            'rsi_1y_history_dates': [],
            'rsi_1y_history_values': [],
            'ema_1y_history_dates': [],
            'ema13_1y_history_values': [],
            'ema21_1y_history_values': [],
            'ema100_1y_history_values': [],
            'ema200_1y_history_values': [],
            'drawdown_history_dates': [],
            'drawdown_history_values': [],
            'ema50_1y_history_values': []
        }

        # Calculate signals and last signal dates
        if result_dict['ema13'] is not None and result_dict['ema21'] is not None:
            if result_dict['ema13'] > result_dict['ema21']:
                result_dict['ema_signal'] = 'Buy'
                if 'EMA13' in combined_data.columns and 'EMA21' in combined_data.columns:
                    result_dict['ema_short_last_signal_date'] = find_last_ema_bullish_crossover_date(combined_data['EMA13'], combined_data['EMA21'])
            elif result_dict['ema13'] < result_dict['ema21']:
                result_dict['ema_signal'] = 'Sell'
                if 'EMA13' in combined_data.columns and 'EMA21' in combined_data.columns:
                    result_dict['ema_short_last_signal_date'] = find_last_ema_bearish_crossover_date(combined_data['EMA13'], combined_data['EMA21'])

        if result_dict['ema50'] is not None and result_dict['ema200'] is not None:
            if result_dict['ema50'] > result_dict['ema200']:
                result_dict['ema_long_signal'] = 'Buy'
                if 'EMA50' in combined_data.columns and 'EMA200' in combined_data.columns:
                    result_dict['ema_long_last_signal_date'] = find_last_ema_bullish_crossover_date(combined_data['EMA50'], combined_data['EMA200'])
            elif result_dict['ema50'] < result_dict['ema200']:
                result_dict['ema_long_signal'] = 'Sell'
                if 'EMA50' in combined_data.columns and 'EMA200' in combined_data.columns:
                    result_dict['ema_long_last_signal_date'] = find_last_ema_bearish_crossover_date(combined_data['EMA50'], combined_data['EMA200'])

        asset_1y_change = calculate_period_change(close_prices, '1y')

        if spy_1y_change is not None and symbol != 'SPY':
            if asset_1y_change is not None:
                 result_dict['relative_perf_1y'] = asset_1y_change - spy_1y_change
            else:
                 result_dict['relative_perf_1y'] = None
        elif symbol == 'SPY':
             result_dict['relative_perf_1y'] = 0.0

        if len(close_prices) >= 2:
            sparkline_start_date = get_start_date_from_period(change_period_str, reference_date=close_prices.index[-1])
            if close_prices.index.tz is None: close_prices_index_utc = close_prices.index.tz_localize('UTC')
            else: close_prices_index_utc = close_prices.index.tz_convert('UTC')
            sparkline_prices = close_prices[close_prices_index_utc >= sparkline_start_date]
            if not sparkline_prices.empty:
                 result_dict['sparkline_data'] = [p for p in sparkline_prices.tolist() if pd.notna(p)]
            else:
                 sparkline_points = close_prices.tail(2).tolist()
                 result_dict['sparkline_data'] = [p for p in sparkline_points if pd.notna(p)]
        else:
            result_dict['sparkline_data'] = []

        asset_1y_cum_ret = calculate_cumulative_return(close_prices, '1y')
        if not asset_1y_cum_ret.empty:
            result_dict['asset_1y_history_dates'] = asset_1y_cum_ret.index.strftime('%Y-%m-%d').tolist()
            result_dict['asset_1y_history_values'] = [round(v, 2) for v in asset_1y_cum_ret.values.tolist()]

        if 'RSI14' in indicators.columns:
            rsi_series = indicators['RSI14'].dropna()
            if not rsi_series.empty and len(rsi_series) >= 2:
                rsi_latest_date = rsi_series.index[-1]
                if rsi_latest_date.tzinfo is None: rsi_latest_date = rsi_latest_date.tz_localize('UTC')
                else: rsi_latest_date = rsi_latest_date.astimezone(timezone.utc)
                rsi_start_date = get_start_date_from_period('1y', reference_date=rsi_latest_date)
                if rsi_series.index.tz is None: rsi_index_utc = rsi_series.index.tz_localize('UTC')
                else: rsi_index_utc = rsi_series.index.tz_convert('UTC')
                rsi_1y_series = rsi_series[rsi_index_utc >= rsi_start_date]
                if not rsi_1y_series.empty:
                    result_dict['rsi_1y_history_dates'] = rsi_1y_series.index.strftime('%Y-%m-%d').tolist()
                    result_dict['rsi_1y_history_values'] = [round(v, 2) for v in rsi_1y_series.values.tolist()]

        if 'EMA13' in indicators.columns:
            ema13_series_raw = indicators['EMA13'].dropna()
            if not ema13_series_raw.empty and len(ema13_series_raw) >= 2:
                ema_latest_date = ema13_series_raw.index[-1]
                if ema_latest_date.tzinfo is None: ema_latest_date = ema_latest_date.tz_localize('UTC')
                else: ema_latest_date = ema_latest_date.astimezone(timezone.utc)
                ema_start_date = get_start_date_from_period('1y', reference_date=ema_latest_date)
                if ema13_series_raw.index.tz is None: ema13_index_utc = ema13_series_raw.index.tz_localize('UTC')
                else: ema13_index_utc = ema13_series_raw.index.tz_convert('UTC')
                ema_1y_target_index = ema13_series_raw[ema13_index_utc >= ema_start_date].index
                if not ema_1y_target_index.empty:
                    result_dict['ema_1y_history_dates'] = ema_1y_target_index.strftime('%Y-%m-%d').tolist()
                    num_dates = len(result_dict['ema_1y_history_dates'])
                    ema13_1y_values = ema13_series_raw.reindex(ema_1y_target_index).values
                    result_dict['ema13_1y_history_values'] = [round(v, 2) if pd.notna(v) else None for v in ema13_1y_values]
                    if 'EMA21' in indicators.columns:
                        ema21_series_raw = indicators['EMA21'].dropna()
                        ema21_1y_values = ema21_series_raw.reindex(ema_1y_target_index).values
                        result_dict['ema21_1y_history_values'] = [round(v, 2) if pd.notna(v) else None for v in ema21_1y_values]
                    else:
                        result_dict['ema21_1y_history_values'] = [None] * num_dates
                    if 'EMA50' in indicators.columns:
                        ema50_series_raw = indicators['EMA50'].dropna()
                        ema50_1y_values = ema50_series_raw.reindex(ema_1y_target_index).values
                        result_dict['ema50_1y_history_values'] = [round(v, 2) if pd.notna(v) else None for v in ema50_1y_values]
                    else:
                        result_dict['ema50_1y_history_values'] = [None] * num_dates
                    if 'EMA100' in indicators.columns:
                        ema100_series_raw = indicators['EMA100'].dropna()
                        ema100_1y_values = ema100_series_raw.reindex(ema_1y_target_index).values
                        result_dict['ema100_1y_history_values'] = [round(v, 2) if pd.notna(v) else None for v in ema100_1y_values]
                    else:
                        result_dict['ema100_1y_history_values'] = [None] * num_dates
                    if 'EMA200' in indicators.columns:
                        ema200_series_raw = indicators['EMA200'].dropna()
                        ema200_1y_values = ema200_series_raw.reindex(ema_1y_target_index).values
                        result_dict['ema200_1y_history_values'] = [round(v, 2) if pd.notna(v) else None for v in ema200_1y_values]
                    else:
                        result_dict['ema200_1y_history_values'] = [None] * num_dates

        if not close_prices.empty:
            drawdown_start_date = get_start_date_from_period(drawdown_period_str, reference_date=close_prices.index[-1])
            if close_prices.index.tz is None: close_prices_index_utc = close_prices.index.tz_localize('UTC')
            else: close_prices_index_utc = close_prices.index.tz_convert('UTC')
            drawdown_period_prices = close_prices[close_prices_index_utc >= drawdown_start_date]
            if not drawdown_period_prices.empty and len(drawdown_period_prices) > 1:
                running_peak = drawdown_period_prices.cummax()
                running_peak = running_peak.replace(0, np.nan)
                drawdown_pct_series = ((drawdown_period_prices - running_peak) / running_peak) * 100
                drawdown_pct_series = drawdown_pct_series.fillna(0)
                result_dict['drawdown_history_dates'] = drawdown_pct_series.index.strftime('%Y-%m-%d').tolist()
                result_dict['drawdown_history_values'] = [round(v, 2) for v in drawdown_pct_series.values.tolist() if pd.notna(v)]
                if len(result_dict['drawdown_history_values']) != len(result_dict['drawdown_history_dates']):
                    result_dict['drawdown_history_dates'] = []
                    result_dict['drawdown_history_values'] = []
        
        return result_dict

    except Exception as e:
        print(f"Error processing {symbol}: {e}")
        return {'name': symbol, 'display_name': MARKET_SYMBOLS.get(symbol, symbol), 'error': str(e)}

def fetch_and_process_asset_data(symbol, drawdown_period_str='1y', change_period_str='1d',
                               spy_1y_change=None, # Keep for tooltip calculation
                               is_market_symbol=False):
    """Fetches data and passes it to the processing function."""
    attempts = 0
    stock_data_raw = pd.DataFrame()
    while attempts < MAX_RETRY_ATTEMPTS:
        try:
            if attempts > 0:
                jitter = random.uniform(0.1, 0.5)
                time.sleep(RETRY_DELAY_BASE * attempts + jitter)
            
            if is_market_symbol:
                print(f"--- Market Symbol Fetch Start: {symbol} ---")

            stock_data_raw = yf.download(symbol, period=DATA_FETCH_PERIOD, interval="1d", progress=False, auto_adjust=False, actions=False)
            
            if stock_data_raw.empty:
                attempts += 1
                print(f"Attempt {attempts}: Empty data received for {symbol}. Retrying...")
                continue
            
            # Basic validation before passing to processor
            if isinstance(stock_data_raw.columns, pd.MultiIndex):
                if symbol not in stock_data_raw.columns.levels[1]:
                    print(f"Error for {symbol}: MultiIndex received, but requested symbol '{symbol}' not in Ticker level. Tickers found: {stock_data_raw.columns.levels[1]}. Discarding data.")
                    stock_data_raw = pd.DataFrame() # Invalidate
                    attempts += 1
                    continue
                else:
                    # Extract the symbol's data
                    stock_data_raw = stock_data_raw.xs(symbol, level=1, axis=1)

            if 'Close' not in stock_data_raw.columns or stock_data_raw['Close'].isna().all():
                 attempts += 1
                 print(f"Attempt {attempts}: Data for {symbol} is missing 'Close' column or has no valid close prices. Retrying...")
                 continue

            # If we reach here, data seems plausible enough to process
            return _process_symbol_data(symbol, stock_data_raw, drawdown_period_str, change_period_str, spy_1y_change, is_market_symbol)

        except Exception as e:
            attempts += 1
            print(f"Attempt {attempts}: Error fetching data for {symbol}: {e}. Retrying...")
            if attempts >= MAX_RETRY_ATTEMPTS:
                print(f"Max retries reached for {symbol}. Returning error.")
                return {'name': symbol, 'display_name': MARKET_SYMBOLS.get(symbol, symbol), 'error': str(e)}

    # If all retries fail
    return {'name': symbol, 'display_name': MARKET_SYMBOLS.get(symbol, symbol), 'error': f"Failed to fetch data for {symbol} after {MAX_RETRY_ATTEMPTS} attempts."}

# --- API Endpoints ---
@app.route('/api/dashboard-data')
def get_dashboard_data():
    """API endpoint to get processed data for market and asset symbols."""
    drawdown_period = request.args.get('drawdown_period', default='1y', type=str)
    change_period = request.args.get('change_period', default='1d', type=str) # Get change_period
    print(f"API: Using drawdown period: {drawdown_period}, change period: {change_period}")

    market_data = {}
    asset_data = {}
    spy_1y_change = None
    spy_1y_history_dates = []
    spy_1y_history_values = []

    # --- Pre-fetch SPY data for relative performance calculation ---
    print("API: Pre-fetching SPY for 1Y change and historical relative performance...")
    
    # Use retry mechanism for SPY as well
    spy_attempts = 0
    spy_data_raw = pd.DataFrame() # Initialize to ensure it's defined
    while spy_attempts < MAX_RETRY_ATTEMPTS:
        try:
            if spy_attempts > 0:
                # Add jitter to retry
                jitter = random.uniform(0.1, 0.5)
                time.sleep(RETRY_DELAY_BASE * spy_attempts + jitter)
                
            # Fetch slightly more than 1 year to ensure enough data for calculation start point
            spy_data_raw = yf.download('SPY', period="13mo", interval="1d", progress=False, auto_adjust=False, actions=False)

            # Handle potential MultiIndex columns returned by yfinance
            if isinstance(spy_data_raw.columns, pd.MultiIndex):
                # Check if 'SPY' is actually in the 'Ticker' level of the MultiIndex
                if 'SPY' in spy_data_raw.columns.levels[1]:
                    spy_data_raw = spy_data_raw.xs('SPY', level=1, axis=1)
                    print("API: SPY data successfully extracted from MultiIndex during pre-fetch.")
                else:
                    # The MultiIndex does not contain 'SPY' data; it's for other tickers.
                    print(f"API Error (SPY pre-fetch): MultiIndex received, but 'SPY' not in Ticker level. Tickers found: {spy_data_raw.columns.levels[1]}. Discarding SPY pre-fetch data.")
                    spy_data_raw = pd.DataFrame() # Invalidate data
            # If not a MultiIndex, it's assumed to be a simple pd.Index for SPY.

            if spy_data_raw.empty or 'Close' not in spy_data_raw.columns:
                spy_attempts += 1
                print(f"API: Attempt {spy_attempts} - Failed to get SPY data (empty or no Close). Retrying...")
                continue
                
            spy_close_prices = spy_data_raw['Close'].dropna()
            if len(spy_close_prices) < 2:
                spy_attempts += 1
                print(f"API: Attempt {spy_attempts} - Not enough SPY data points. Retrying...")
                continue
                
            # Data looks good, exit retry loop
            break
            
        except Exception as e:
            spy_attempts += 1
            print(f"API: Attempt {spy_attempts} - Error fetching SPY data: {e}")
            if spy_attempts >= MAX_RETRY_ATTEMPTS:
                print("API: Max retries reached for SPY data. Continuing without it.")
                break
    
    # If SPY data was successfully fetched, calculate indicators
    if not spy_data_raw.empty and 'Close' in spy_data_raw.columns:
        spy_close_prices = spy_data_raw['Close'].dropna()
        if len(spy_close_prices) >= 2:
            # Calculate final 1Y change (for tooltip/backup)
            spy_1y_change_calc = calculate_period_change(spy_close_prices, '1y') # Renamed to avoid conflict
            if spy_1y_change_calc is not None and pd.notna(spy_1y_change_calc):
                 print(f"API: SPY 1Y Change calculated: {spy_1y_change_calc:.2f}%")
                 spy_1y_change = spy_1y_change_calc # Assign to the broader scope variable
            else:
                 print("API: SPY 1Y Change calculation resulted in None or NaN.")
                 spy_1y_change = None # Ensure it's None if calculation failed

            # Calculate 1Y cumulative return series (for graph)
            spy_1y_cum_ret_series_calc = calculate_cumulative_return(spy_close_prices, '1y') # Renamed
            if spy_1y_cum_ret_series_calc.empty:
                print("API: SPY 1Y Cumulative Return series calculation failed or resulted in empty series.")
                # spy_1y_cum_ret_series remains None (or its initial value if it was one)
            else:
                print(f"API: SPY 1Y Cumulative Return series calculated with {len(spy_1y_cum_ret_series_calc)} points.")
                # Store dates and values for the main response
                spy_1y_history_dates = spy_1y_cum_ret_series_calc.index.strftime('%Y-%m-%d').tolist()
                spy_1y_history_values = [round(v, 2) for v in spy_1y_cum_ret_series_calc.values.tolist()]
    else:
        print("API: SPY data could not be fetched or was insufficient after retries. Relative calculations may be affected.")


    print("API: Fetching Market and Asset Data in a single batch...")
    # Combine all symbols into one list, ensuring no duplicates
    all_symbols = list(MARKET_SYMBOLS.keys()) + SYMBOLS
    all_symbols = sorted(list(set(all_symbols))) # Sort for deterministic behavior

    # Fetch all data in a single batch request
    all_data_raw = yf.download(all_symbols, period=DATA_FETCH_PERIOD, interval="1d", progress=False, auto_adjust=False, actions=False)

    if all_data_raw.empty:
        print("API Error: Batch download returned no data at all.")
        # Create error objects for all symbols
        for symbol in all_symbols:
            if symbol in MARKET_SYMBOLS:
                market_data[symbol] = {'name': symbol, 'display_name': MARKET_SYMBOLS.get(symbol, symbol), 'error': 'Batch download failed.'}
            if symbol in ASSET_LIST:
                 asset_data[symbol] = {'name': symbol, 'display_name': symbol, 'error': 'Batch download failed.'}
    else:
        print("API: Batch download complete. Processing symbols sequentially...")
        # Process each symbol from the batch
        for symbol in all_symbols:
            is_market = symbol in MARKET_SYMBOLS
            try:
                # Extract the data for the current symbol. It might be a MultiIndex or a single Index
                if isinstance(all_data_raw.columns, pd.MultiIndex):
                     if symbol in all_data_raw.columns.levels[1]:
                         symbol_df = all_data_raw.xs(symbol, level=1, axis=1)
                     else:
                         print(f"API Warning: {symbol} not found in batch download MultiIndex columns.")
                         symbol_df = pd.DataFrame() # Empty frame to signal error
                else: # Should not happen with multi-symbol download, but handle defensively
                    symbol_df = all_data_raw 

                # Process the extracted data
                result = _process_symbol_data(symbol, symbol_df, drawdown_period, change_period, spy_1y_change, is_market_symbol=is_market)

                if is_market:
                    market_data[symbol] = result
                # A symbol can be both (like SPY), so we add it to assets as well if it's in the asset list
                if symbol in ASSET_LIST:
                    asset_data[symbol] = result

            except Exception as e:
                print(f"API Error: Unhandled exception processing {symbol} from batch: {e}")
                error_obj = {'name': symbol, 'display_name': MARKET_SYMBOLS.get(symbol, symbol) or symbol, 'error': str(e)}
                if is_market:
                    market_data[symbol] = error_obj
                if symbol in ASSET_LIST:
                    asset_data[symbol] = error_obj

    print(f"API: Returning data for {len(market_data)} market symbols and {len(asset_data)} assets.")
    return jsonify({
        'market_data': market_data,
        'asset_data': asset_data,
        'spy_1y_history': { # Add SPY history to the main response
            'dates': spy_1y_history_dates,
            'values': spy_1y_history_values
        }
    })

# --- Static File Serving ---
@app.route('/')
def serve_index():
    """Serves the main index.html file."""
    return send_from_directory(app.static_folder, 'index.html')

@app.route('/<path:path>')
def serve_static_files(path):
    """Serves other static files (CSS, JS)."""
    return send_from_directory(app.static_folder, path)

# --- Main Execution ---
if __name__ == '__main__':
    app.run(debug=True, port=5004)