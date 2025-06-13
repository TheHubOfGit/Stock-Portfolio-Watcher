# Real-Time Stock Dashboard

A modern, responsive stock dashboard built with Python Flask backend and vanilla JavaScript frontend. Features real-time stock data, technical indicators, and sentiment analysis.

## Features

- **Real-time Stock Data**: Live price updates and market data via yFinance
- **Technical Indicators**: RSI, EMA (13, 21, 50, 200), trend analysis
- **Interactive Charts**: Sparkline trends and popup detailed charts
- **Dark/Light Theme**: Toggle between themes for better viewing experience
- **Responsive Design**: Works on desktop and mobile devices
- **Multiple Asset Types**: Stocks, ETFs, and Cryptocurrency support

## Tech Stack

### Backend
- **Python 3.9+**
- **Flask** - Web framework
- **yFinance** - Financial data API
- **Pandas** - Data manipulation and analysis
- **NumPy** - Numerical computing

### Frontend
- **Vanilla JavaScript** - No frameworks, pure JS
- **CSS3** - Modern styling with CSS Grid and Flexbox
- **Chart.js** - Interactive charts and visualizations
- **Responsive Design** - Mobile-first approach

## Installation

### Prerequisites
- Python 3.9 or higher
- pip (Python package installer)

### Setup

1. **Clone the repository**
   ```bash
   git clone https://github.com/yourusername/stock-dashboard.git
   cd stock-dashboard
   ```

2. **Set up Python virtual environment**
   ```bash
   cd backend
   python -m venv venv
   source venv/bin/activate  # On Windows: venv\Scripts\activate
   ```

3. **Install Python dependencies**
   ```bash
   pip install flask flask-cors yfinance pandas numpy python-dotenv
   ```

4. **Run the application**
   ```bash
   python app.py
   ```

5. **Open your browser**
   Navigate to `http://localhost:5000`

## Usage

### Dashboard Features

- **Stock Table**: View all tracked stocks with real-time data
- **Sorting**: Click column headers to sort by any metric
- **Theme Toggle**: Switch between dark and light themes
- **Period Selection**: Change time periods for analysis
- **Refresh**: Manual refresh button for immediate updates
- **Popup Charts**: Click trend sparklines for detailed charts

### Adding New Stocks

To add new stocks to the dashboard:

1. Open `backend/app.py`
2. Add your stock symbol to the `ASSET_LIST` dictionary:
   ```python
   ASSET_LIST = {
       # ... existing stocks ...
       'NEW': 'Stock',  # Replace 'NEW' with actual ticker
   }
   ```
3. Restart the backend server

### Technical Indicators

- **RSI (14)**: Relative Strength Index for overbought/oversold signals
- **EMA Signals**: Short-term (13/21) and long-term (50/200) moving averages
- **Drawdown**: Maximum decline from peak over selected period
- **Trend Analysis**: 30-day price trend visualization

## Project Structure

```
stock-dashboard/
├── backend/
│   ├── app.py              # Main Flask application
│   └── venv/               # Python virtual environment
├── frontend/
│   ├── index.html          # Main HTML file
│   ├── script.js           # JavaScript logic
│   └── style.css           # Styling and themes
├── .gitignore              # Git ignore rules
├── README.md               # This file
└── PLAN.md                 # Development planning notes
```

## Configuration

### Supported Assets

The dashboard currently tracks:

| Ticker    | Company                             | Type   |
|-----------|-------------------------------------|--------|
| BA        | Boeing Company                      | Stock  |
| ABNB      | Airbnb, Inc.                        | Stock  |
| SHOP      | Shopify Inc.                        | Stock  |
| WDAY      | Workday, Inc.                       | Stock  |
| SWBI      | Smith & Wesson Brands, Inc.         | Stock  |
| COIN      | Coinbase Global, Inc.               | Stock  |
| QCOM      | QUALCOMM Incorporated               | Stock  |
| AMD       | Advanced Micro Devices, Inc.        | Stock  |
| NVDA      | NVIDIA Corporation                  | Stock  |
| PLTR      | Palantir Technologies Inc.          | Stock  |
| EQIX      | Equinix, Inc.                       | Stock  |
| DIS       | The Walt Disney Company             | Stock  |
| PFE       | Pfizer Inc.                         | Stock  |
| PSEC      | Prospect Capital Corporation        | Stock  |
| TSLA      | Tesla, Inc.                         | Stock  |
| MSFT      | Microsoft Corporation               | Stock  |
| GOOG      | Alphabet Inc. (GOOGL/GOOG)          | Stock  |
| AMZN      | Amazon.com, Inc.                    | Stock  |
| AAPL      | Apple Inc.                          | Stock  |
| V         | Visa Inc.                           | Stock  |
| UAL       | United Airlines Holdings, Inc.      | Stock  |
| DAL       | Delta Air Lines, Inc.               | Stock  |
| NOW       | ServiceNow, Inc.                    | Stock  |
| CRM       | Salesforce, Inc.                    | Stock  |
| DUK       | Duke Energy Corporation             | Stock  |
| GEV       | GE Vernova Inc.                     | Stock  |
| CEG       | Constellation Energy Corporation    | Stock  |
| PM        | Philip Morris International Inc.    | Stock  |
| SOXX      | iShares Semiconductor ETF           | ETF    |
| SPXL      | Direxion Daily S&P 500 Bull 3X ETF  | ETF    |
| TQQQ      | ProShares UltraPro QQQ              | ETF    |
| XAR       | SPDR S&P Aerospace & Defense ETF    | ETF    |
| BTC-USD   | Bitcoin                             | Crypto |
| LTC-USD   | Litecoin                            | Crypto |

- **Stocks**: Major US equities (AAPL, MSFT, GOOGL, etc.)

### Data Sources

- **yFinance**: Primary data source for all market data
- **Update Frequency**: Approximately every minute during market hours
- **Historical Data**: 5 years of data for technical analysis

## API Endpoints

- `GET /`: Serve the main dashboard
- `GET /api/dashboard-data`: Get all stock data with indicators

## Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## License

This project is open source and available under the [MIT License](LICENSE).

## Acknowledgments

- **yFinance** for providing free financial data API
- **Chart.js** for beautiful charting capabilities
- **Flask** community for excellent documentation 