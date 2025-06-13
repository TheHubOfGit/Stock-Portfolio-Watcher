function initializeDashboard() {
    console.log("initializeDashboard() called."); // Log start of initialization

    // --- Element Selection with Checks ---
    const stockTableBody = document.getElementById('stock-table-body');
    if (!stockTableBody) console.error("Element with ID 'stock-table-body' not found!");

    const refreshButton = document.getElementById('refresh-btn');
    if (!refreshButton) console.error("Element with ID 'refresh-btn' not found!");

    const lastUpdatedElement = document.getElementById('last-updated');
    if (!lastUpdatedElement) console.error("Element with ID 'last-updated' not found!");

    const drawdownPeriodSelect = document.getElementById('drawdown-period');
    if (!drawdownPeriodSelect) console.error("Element with ID 'drawdown-period' not found!");

    const changePeriodSelect = document.getElementById('change-period');
    if (!changePeriodSelect) console.error("Element with ID 'change-period' not found!");

    const themeToggle = document.getElementById('theme-toggle');
    if (!themeToggle) console.error("Element with ID 'theme-toggle' not found!");

    const popupChartContainer = document.getElementById('popup-chart-container');
    if (!popupChartContainer) console.error("Element with ID 'popup-chart-container' not found!");

    const chartCanvas = document.getElementById('relative-perf-chart');
    if (!chartCanvas) console.error("Element with ID 'relative-perf-chart' not found!");

    const refreshSpinner = document.getElementById('refresh-spinner'); // Added spinner selector
    if (!refreshSpinner) console.error("Element with ID 'refresh-spinner' not found!");

    const chartOverlayTextElement = document.getElementById('chart-overlay-text'); // Get overlay element
     if (!chartOverlayTextElement) console.error("Element with ID 'chart-overlay-text' not found!");


    console.log("Element selections complete (or errors logged).");

    // --- State Variables ---
    let updateInterval;
    let currentMarketData = {}; // Store market data separately
    let currentAssetData = []; // Store asset data for sorting
    let sortColumn = 'type'; // Initial sort column for assets
    let sortDirection = 'asc'; // Initial sort direction
    let popupChartInstance = null; // To hold the Chart.js instance (for Perf, RSI, EMA, or Drawdown)
    let spyHistoryData = null; // To store SPY's 1y history globally
    let isInitialLoad = true; // Flag to track initial load vs refresh

    // --- Configuration ---
    const API_ENDPOINT = '/api/dashboard-data'; // Ensure endpoint is correct
    const REFRESH_INTERVAL_MS = 60 * 1000; // 60 seconds
    const marketSymbolsList = ['SPY', '^DJI', '^GSPC', '^VIX']; // Define market symbols
    const LOCAL_STORAGE_KEY = 'stockDashboardData';
    const STALE_DATA_THRESHOLD_MS = 5 * 60 * 1000; // 5 minutes - threshold for considering data stale

    // --- Functions ---

    // Updated showLoading to only handle spinner and body class
    function showLoading(isLoading, isRefreshing = false) {
        // Ensure spinner element exists
        if (!refreshSpinner) {
            console.error("showLoading: refreshSpinner element not found!");
            return;
        }

        if (isLoading) {
            // Show spinner and potentially the page border animation
            refreshSpinner.style.display = 'inline-block';
            if (isRefreshing) {
                document.body.classList.add('page-refreshing');
            } else {
                // Ensure page border animation is off during initial load
                document.body.classList.remove('page-refreshing');
            }
        } else {
            // Hide spinner and page border animation
            refreshSpinner.style.display = 'none';
            document.body.classList.remove('page-refreshing');
        }
    } // End of showLoading function

    // Check if data is stale based on last_updated timestamp
    function isDataStale(stockData) {
        if (!stockData || !stockData.last_updated) return true;
        
        try {
            const lastUpdated = new Date(stockData.last_updated);
            const now = new Date();
            return now - lastUpdated > STALE_DATA_THRESHOLD_MS;
        } catch (e) {
            console.error("Error checking data staleness:", e);
            return true;
        }
    }

    function formatNumber(num, decimals = 2) {
        if (num === null || num === undefined || isNaN(num)) {
            return 'N/A';
        }
        const number = parseFloat(num);
        // Use toLocaleString for comma separation and fixed decimals
        return number.toLocaleString('en-US', {
            minimumFractionDigits: decimals,
            maximumFractionDigits: decimals
        });
    }

    // --- Sparkline Function ---
    function createSparkline(data, width = 80, height = 20, stroke = 'var(--text-color)', strokeWidth = 1.5) {
        if (!data || data.length < 2) {
            return document.createTextNode('N/A'); // Not enough data
        }

        const svgNS = "http://www.w3.org/2000/svg";
        const svg = document.createElementNS(svgNS, "svg");
        svg.setAttribute('width', width);
        svg.setAttribute('height', height);
        svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
        svg.style.overflow = 'visible'; // Prevent clipping stroke

        const maxVal = Math.max(...data);
        const minVal = Math.min(...data);
        const range = maxVal - minVal || 1; // Avoid division by zero if all values are the same

        const points = data.map((d, i) => {
            const x = (i / (data.length - 1)) * width;
            const y = height - ((d - minVal) / range) * height;
            // Add slight vertical padding to prevent touching edges
            const paddedY = Math.max(strokeWidth, Math.min(height - strokeWidth, y));
            return `${x},${paddedY}`;
        }).join(' ');

        const polyline = document.createElementNS(svgNS, "polyline");
        polyline.setAttribute('points', points);
        polyline.setAttribute('fill', 'none');
        polyline.setAttribute('stroke', stroke);
        polyline.setAttribute('stroke-width', strokeWidth);
        polyline.setAttribute('stroke-linejoin', 'round');
        polyline.setAttribute('stroke-linecap', 'round');

        svg.appendChild(polyline);
        return svg;
    }

    // Helper function to render a single row
    function renderRow(stock) {
        const row = document.createElement('tr');
        row.setAttribute('data-symbol', stock.name);
        
        // Mark row as stale if data is old
        if (isDataStale(stock)) {
            row.classList.add('stale-data');
        }

        // Define cell content based on available data
        row.innerHTML = `
            <td class="symbol">${stock.display_name || stock.name}</td>
            <td class="type"></td> <!-- Type content set dynamically below -->
            <td class="price"></td>
            <td class="change"></td>
            <td class="sparkline-cell"></td> <!-- Added Sparkline Cell -->
            <td class="rsi"></td>
            <td class="rsi-status"></td> <!-- Added RSI Status cell -->
            <td class="ema13"></td>
            <td class="ema21"></td>
            <td class="signal"></td>
            <td class="duration-short"></td>
            <td class="ema50"></td>
            <td class="ema200"></td>
            <td class="signal-long"></td>
            <td class="duration-long"></td>
            <td class="drawdown"></td>
            <!-- Removed last-update-time cell -->
        `;
        // Check if stockTableBody exists before appending
        if (stockTableBody) {
            stockTableBody.appendChild(row); // Append row to the table body
        } else {
            console.error("renderRow: stockTableBody is null, cannot append row.");
            return; // Exit if table body doesn't exist
        }


        // Select cells
        const typeCell = row.querySelector('.type');

        // Set Type cell content conditionally
        if (marketSymbolsList.includes(stock.name)) {
            typeCell.textContent = ''; // Leave type blank for market symbols
        } else {
            typeCell.textContent = stock.type || 'N/A'; // Show type for assets
        }

        // Populate other cells (only if not an error row)
        if (!stock.error) {
            const priceCell = row.querySelector('.price');
            const changeCell = row.querySelector('.change');
            const sparklineCell = row.querySelector('.sparkline-cell'); // Select sparkline cell
            const rsiCell = row.querySelector('.rsi'); // Cell for RSI value
            const rsiStatusCell = row.querySelector('.rsi-status'); // Select the new cell
            const ema13Cell = row.querySelector('.ema13'); // Cell for EMA13 value
            const ema21Cell = row.querySelector('.ema21'); // Cell for EMA21 value
            const signalCell = row.querySelector('.signal');
            const buyDurationShortCell = row.querySelector('.duration-short');
            const ema50Cell = row.querySelector('.ema50');
            const ema200Cell = row.querySelector('.ema200');
            const signalLongCell = row.querySelector('.signal-long');
            const lastBuyDateLongCell = row.querySelector('.duration-long');
            const drawdownCell = row.querySelector('.drawdown'); // Cell for Drawdown value

            // Populate cells (excluding typeCell, already done)
            // Format price with dollar sign and commas
            priceCell.textContent = `$${formatNumber(stock.latest_price)}`;
            const changePct = formatNumber(stock.daily_change_pct);
            changeCell.textContent = `${changePct}%`;
            changeCell.className = `change ${stock.daily_change_pct >= 0 ? 'positive' : 'negative'}`;

            // Render Sparkline
            if (stock.sparkline_data && stock.sparkline_data.length > 1) {
                const sparklineSvg = createSparkline(stock.sparkline_data);
                sparklineCell.appendChild(sparklineSvg);
            } else {
                sparklineCell.textContent = 'N/A';
            }

            const rsiValue = stock.rsi14;
            rsiCell.textContent = formatNumber(rsiValue, 0); // Display the RSI number first, rounded to 0 decimals

            // Populate RSI Status cell
            rsiStatusCell.textContent = ''; // Default to empty
            rsiStatusCell.className = 'rsi-status'; // Reset class
            if (rsiValue !== null && rsiValue !== undefined && !isNaN(rsiValue)) {
                if (rsiValue < 30) {
                    rsiStatusCell.textContent = 'Oversold';
                    rsiStatusCell.classList.add('positive'); // Changed to positive (green)
                } else if (rsiValue > 70) {
                    rsiStatusCell.textContent = 'Overbought'; // Corrected text
                    rsiStatusCell.classList.add('negative'); // Changed to negative (red)
                }
            } else {
                 rsiStatusCell.textContent = 'N/A'; // Handle cases where RSI is not available
            }

            ema13Cell.textContent = formatNumber(stock.ema13);
            ema21Cell.textContent = formatNumber(stock.ema21);
            ema50Cell.textContent = formatNumber(stock.ema50);
            ema200Cell.textContent = formatNumber(stock.ema200);
            drawdownCell.textContent = `${formatNumber(stock.current_drawdown_pct)}%`;

            // Signals and Durations
            const signalShort = stock.ema_signal || 'Neutral';
            signalCell.textContent = signalShort;
            signalCell.className = `signal ${signalShort === 'Buy' ? 'positive' : (signalShort === 'Sell' ? 'negative' : '')}`;
            if (stock.ema_short_last_signal_date) {
                const days = Math.round((new Date() - new Date(stock.ema_short_last_signal_date)) / (1000 * 60 * 60 * 24));
                buyDurationShortCell.textContent = `${days} days`;
            } else {
                buyDurationShortCell.textContent = 'N/A';
            }

            const signalLong = stock.ema_long_signal || 'Neutral';
            signalLongCell.textContent = signalLong;
            signalLongCell.className = `signal-long ${signalLong === 'Buy' ? 'positive' : (signalLong === 'Sell' ? 'negative' : '')}`;
            if (stock.ema_long_last_signal_date) {
                const days = Math.round((new Date() - new Date(stock.ema_long_last_signal_date)) / (1000 * 60 * 60 * 24));
                lastBuyDateLongCell.textContent = `${days} days`;
            } else {
                lastBuyDateLongCell.textContent = 'N/A';
            }

        } else {
            // Handle error display for the row
            row.querySelector('.price').textContent = 'Error';
            row.querySelector('.change').textContent = stock.error;
            row.querySelector('.change').className = 'change negative';
            // Clear other cells, including sparkline and the new rsi-status
            row.querySelectorAll('td:not(.symbol):not(.type):not(.change)').forEach(td => {
                td.textContent = 'N/A';
                // Reset specific classes to avoid lingering styles
                if (td.classList.contains('signal')) td.className = 'signal';
                if (td.classList.contains('signal-long')) td.className = 'signal-long';
                if (td.classList.contains('rsi-status')) td.className = 'rsi-status'; // Reset RSI status class
                if (td.classList.contains('sparkline-cell')) td.innerHTML = 'N/A'; // Clear sparkline cell content
            });
        }

        // --- Add Event Listeners for RSI Chart ---
        const rsiValueCell = row.querySelector('.rsi');
        if (rsiValueCell && !stock.error) { // MODIFIED: Allow for market symbols
             // Pass the specific stock data to the listeners
            const currentStockData = stock;
            rsiValueCell.addEventListener('mouseover', (event) => {
                event.stopPropagation();
                showRsiChart(event, currentStockData);
            });
            rsiValueCell.addEventListener('mouseout', (event) => {
                event.stopPropagation();
                hidePopupChart();
            });
        }
        // --- End RSI Chart Listeners ---

        // --- Add Event Listeners for EMA Charts (Short and Long) ---
        const ema13ValueCell = row.querySelector('.ema13');
        const ema21ValueCell = row.querySelector('.ema21');
        const ema50ValueCell = row.querySelector('.ema50');
        const ema200ValueCell = row.querySelector('.ema200');

        const commonEmaMouseoutHandler = (event) => {
            event.stopPropagation();
            hidePopupChart();
        };

        if (!stock.error) { // MODIFIED: Allow for market symbols
            const currentStockData = stock;

            // Short-term EMAs (13 & 21)
            if (ema13ValueCell || ema21ValueCell) {
                const handleShortEmaMouseover = (event) => {
                    event.stopPropagation();
                    showEmaChart(event, currentStockData, 'short');
                };
                if (ema13ValueCell) {
                    ema13ValueCell.addEventListener('mouseover', handleShortEmaMouseover);
                    ema13ValueCell.addEventListener('mouseout', commonEmaMouseoutHandler);
                }
                if (ema21ValueCell) {
                    ema21ValueCell.addEventListener('mouseover', handleShortEmaMouseover);
                    ema21ValueCell.addEventListener('mouseout', commonEmaMouseoutHandler);
                }
            }

            // Long-term EMAs (100 & 200)
            if (ema50ValueCell || ema200ValueCell) {
                const handleLongEmaMouseover = (event) => {
                    event.stopPropagation();
                    showEmaChart(event, currentStockData, 'long');
                };
                if (ema50ValueCell) {
                    ema50ValueCell.addEventListener('mouseover', handleLongEmaMouseover);
                    ema50ValueCell.addEventListener('mouseout', commonEmaMouseoutHandler);
                }
                if (ema200ValueCell) {
                    ema200ValueCell.addEventListener('mouseover', handleLongEmaMouseover);
                    ema200ValueCell.addEventListener('mouseout', commonEmaMouseoutHandler);
                }
            }
        }
        // --- End EMA Chart Listeners ---


        // --- Add Event Listeners for Relative Performance Chart (Symbol Cell) ---
        const symbolCell = row.querySelector('.symbol');
        if (symbolCell && !stock.error) { // MODIFIED: Allow for market symbols
            const currentStockData = stock;

            symbolCell.addEventListener('mouseover', (event) => {
                showRelativePerfChart(event, currentStockData);
            });
            symbolCell.addEventListener('mouseout', (event) => {
                hidePopupChart();
            });
        }
        // --- End Relative Performance Chart Listeners ---

        // --- Add Event Listeners for Drawdown Chart ---
        const drawdownValueCell = row.querySelector('.drawdown');
        if (drawdownValueCell && !stock.error) { // MODIFIED: Allow for market symbols
            const currentStockData = stock;
            drawdownValueCell.addEventListener('mouseover', (event) => {
                event.stopPropagation();
                showDrawdownChart(event, currentStockData);
            });
            drawdownValueCell.addEventListener('mouseout', (event) => {
                event.stopPropagation();
                hidePopupChart();
            });
        }
        // --- End Drawdown Chart Listeners ---
    }

    // Renders the entire table, including market and sorted asset data
    function renderTable() {
        console.log("renderTable() called"); // Log when renderTable starts
        if (!stockTableBody || !lastUpdatedElement) {
             console.error("renderTable: Required elements (stockTableBody or lastUpdatedElement) not found.");
             return;
        }
        const now = new Date();
        lastUpdatedElement.textContent = `Last Updated: ${now.toLocaleTimeString()}`;
        stockTableBody.innerHTML = ''; // Clear table body

        // --- Render Market Data (Static Top Section) ---
        const marketHeaderRow = document.createElement('tr');
        marketHeaderRow.classList.add('group-header', 'market-header');
        // Dynamically get column count (adjust fallback if needed)
        const colCount = document.querySelectorAll('#stock-table thead th').length;
        marketHeaderRow.innerHTML = `<td colspan="${colCount || 16}">Market Overview</td>`; // Adjusted fallback to 16
        stockTableBody.appendChild(marketHeaderRow);

        const marketOrder = ['SPY', '^DJI', '^GSPC', '^VIX'];
        marketOrder.forEach(symbol => {
            const stock = currentMarketData[symbol];
            if (stock) {
                 renderRow(stock);
            } else {
                 console.warn(`Market data missing for ${symbol}`);
                 const placeholderRow = document.createElement('tr');
                 // Adjust colspan for placeholder row as well
                 placeholderRow.innerHTML = `<td class="symbol">${symbol}</td><td colspan="${(colCount || 16) - 1}">Loading or unavailable...</td>`; // Adjusted fallback
                 stockTableBody.appendChild(placeholderRow);
            }
        });

        // --- Render Asset Data (Sortable Groups) ---
        const sortedAssetData = sortAssetData();
        let currentGroupType = null;

        sortedAssetData.forEach(stock => {
            const stockType = stock.type || 'Unknown';
            if (stockType !== currentGroupType) {
                currentGroupType = stockType;
                const groupHeaderRow = document.createElement('tr');
                groupHeaderRow.classList.add('group-header');
                // Use updated colCount for asset group headers
                groupHeaderRow.innerHTML = `<td colspan="${colCount || 16}">${currentGroupType}s</td>`; // Adjusted fallback to 16
                stockTableBody.appendChild(groupHeaderRow);
            }
            renderRow(stock);
        });

        updateSortIndicators();
        console.log("renderTable() finished"); // Log when renderTable ends
    }


    // --- Sorting Logic (Operates only on currentAssetData) ---
    function sortAssetData() {
        const key = sortColumn;
        const direction = sortDirection === 'asc' ? 1 : -1;
        const typeOrder = { 'ETF': 1, 'Stock': 2, 'Crypto': 3 };

        // Helper to parse 'N/A' and other non-numeric values for sorting
        const getValue = (stock, key) => {
            if (key === 'duration-short' || key === 'duration-long') {
                const dateKey = key === 'duration-short' ? 'ema_short_last_signal_date' : 'ema_long_last_signal_date';
                if (!stock[dateKey]) return -Infinity; // Treat N/A as a very small number to group them at the top/bottom
                // We multiply by direction here to handle asc/desc for dates correctly
                return (new Date() - new Date(stock[dateKey])) * direction;
            }
             // Handle special sorting for signal text
            if (key === 'ema_signal' || key === 'ema_long_signal') {
                const signalOrder = { 'Buy': 1, 'Sell': 3, 'Neutral': 2 };
                return signalOrder[stock[key] || 'Neutral'] || 2;
            }
            // Handle type sorting
            if (key === 'type') {
                 return typeOrder[stock.type || 'Unknown'] || 99;
            }
            // Default value handling
            const value = stock[key];
            if (value === null || value === undefined || value === 'N/A') {
                // Pushes N/A to the bottom regardless of sort direction
                return direction === 1 ? Infinity : -Infinity;
            }
            // For string comparison (like name)
            if (typeof value === 'string') {
                return value.toLowerCase(); // Case-insensitive sorting for names
            }
            // Default numeric parsing
            return parseFloat(value);
        };

        currentAssetData.sort((a, b) => {
            let valA = getValue(a, key);
            let valB = getValue(b, key);

             // Group by type first, unless we are sorting by type
            if (key !== 'type') {
                const typeA = typeOrder[a.type || 'Unknown'] || 99;
                const typeB = typeOrder[b.type || 'Unknown'] || 99;
                if (typeA !== typeB) {
                    return typeA - typeB;
                }
            }
            
            let comparison = 0;
            if (typeof valA === 'string' && typeof valB === 'string') {
                comparison = valA.localeCompare(valB);
            } else {
                if (valA < valB) comparison = -1;
                else if (valA > valB) comparison = 1;
            }
            
            // Apply direction if it's not a date sort (already handled in getValue)
            if (key !== 'duration-short' && key !== 'duration-long') {
                 comparison *= direction;
            }

            // Secondary sort by name if primary values are equal
            if (comparison === 0 && key !== 'name') {
                return (a.display_name || a.name).localeCompare(b.display_name || b.name);
            }

            return comparison;
        });
        return currentAssetData;
    }

    // --- Fetch Data (Only updates data variables) ---
    async function fetchDashboardData() {
        // Check required elements exist before fetching
        if (!drawdownPeriodSelect || !changePeriodSelect) {
             console.error("fetchDashboardData: Period select elements not found.");
             throw new Error("Missing period select elements.");
        }
        const selectedDrawdownPeriod = drawdownPeriodSelect.value;
        const selectedChangePeriod = changePeriodSelect.value; // Get selected change period
        console.log(`Fetching dashboard data with drawdown period: ${selectedDrawdownPeriod} and change period: ${selectedChangePeriod}...`);
        const apiUrl = `${API_ENDPOINT}?drawdown_period=${selectedDrawdownPeriod}&change_period=${selectedChangePeriod}`; // Add change_period to API URL

        const response = await fetch(apiUrl); // Let errors propagate
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        const responseData = await response.json();
        console.log("Data received (first asset):", responseData?.asset_data ? Object.values(responseData.asset_data)[0] : 'No asset data'); // Log sample data

        // Validate market data before storing it
        if (responseData.market_data) {
            // Filter out any invalid entries
            const validatedMarketData = {};
            for (const [symbol, data] of Object.entries(responseData.market_data)) {
                if (data && data.latest_price !== null && data.latest_price !== undefined && !isNaN(data.latest_price)) {
                    validatedMarketData[symbol] = data;
                } else {
                    console.warn(`Skipping invalid market data for ${symbol}:`, data);
                    // If we have previous valid data for this symbol, keep it
                    if (currentMarketData[symbol] && 
                        currentMarketData[symbol].latest_price !== null && 
                        !isNaN(currentMarketData[symbol].latest_price)) {
                        validatedMarketData[symbol] = currentMarketData[symbol];
                        validatedMarketData[symbol].stale = true;
                    }
                }
            }
            currentMarketData = validatedMarketData;
        }

        // Validate asset data before storing it
        if (responseData.asset_data) {
            // Filter out any invalid entries
            const validatedAssetData = [];
            for (const data of Object.values(responseData.asset_data)) {
                if (data && data.name && data.latest_price !== null && data.latest_price !== undefined && !isNaN(data.latest_price)) {
                    validatedAssetData.push(data);
                } else {
                    console.warn(`Skipping invalid asset data:`, data);
                    // If we have previous valid data for this symbol, keep it
                    const existingData = currentAssetData.find(item => item.name === data?.name);
                    if (existingData && 
                        existingData.latest_price !== null && 
                        !isNaN(existingData.latest_price)) {
                        existingData.stale = true;
                        validatedAssetData.push(existingData);
                    }
                }
            }
            currentAssetData = validatedAssetData;
        }

        spyHistoryData = responseData.spy_1y_history || null; // Store SPY history

        saveDataToLocalStorage(); // Save after successful fetch
        // Removed renderTable() call
    }

    // --- Fetch and Render Data ---
    async function fetchAndRenderData() {
        const isRefreshing = !isInitialLoad; // It's a refresh if not the initial load
        console.log(`fetchAndRenderData called. isInitialLoad: ${isInitialLoad}, isRefreshing: ${isRefreshing}`);
        showLoading(true, isRefreshing); // Show loading indicators

        const minDisplayTime = 500; // Minimum time in ms to show loading animation
        const startTime = Date.now();

        try {
            // Fetch data and render table
            await fetchDashboardData();
            renderTable();
            isInitialLoad = false; // Mark initial load complete *after* success

            // Calculate remaining time needed to meet minDisplayTime
            const elapsedTime = Date.now() - startTime;
            const remainingTime = minDisplayTime - elapsedTime;

            // Wait for the remaining time if the fetch was too fast
            if (remainingTime > 0) {
                await new Promise(resolve => setTimeout(resolve, remainingTime));
            }

        } catch (error) {
            console.error("Error fetching or rendering dashboard data:", error);
            if (lastUpdatedElement) lastUpdatedElement.textContent = `Update Error: ${error.message}`;
            // Don't clear data on error if refreshing, keep showing stale data
            if (isInitialLoad) {
                // Clear data only if it's the initial load and it failed
                currentMarketData = {};
                currentAssetData = [];
                spyHistoryData = null;
                localStorage.removeItem(LOCAL_STORAGE_KEY); // Clear storage on initial load error
                renderTable(); // Render empty state
            }
            // Even on error, ensure minimum display time if needed before hiding loading
            const elapsedTime = Date.now() - startTime;
            const remainingTime = minDisplayTime - elapsedTime;
            if (remainingTime > 0) {
                await new Promise(resolve => setTimeout(resolve, remainingTime));
            }
        } finally {
            showLoading(false); // Hide loading indicators
        }
    }

    // --- Pop-up Chart Logic (Shared Container & Instance) ---

    // Shows Relative Performance vs SPY Chart
    function showRelativePerfChart(event, stockData) {
        hidePopupChart(); // Hide any existing chart first

        // MODIFIED: Allow for market symbols by removing marketSymbolsList.includes(stockData.name)
        if (!popupChartContainer || !chartCanvas || !chartOverlayTextElement || !stockData || stockData.error || !stockData.asset_1y_history_dates) {
            hidePopupChart();
            return;
        }

        // Get Asset history
        const assetDates = stockData.asset_1y_history_dates;
        const assetValues = stockData.asset_1y_history_values;

        // Get SPY history (stored globally)
        const spyDates = spyHistoryData?.dates;
        const spyValues = spyHistoryData?.values;

        // Basic validation for chart data
        if (!assetDates || !assetValues || assetDates.length < 2 || assetValues.length < 2 || assetDates.length !== assetValues.length) {
            console.warn(`Insufficient or invalid asset historical performance data for ${stockData.name}`);
            hidePopupChart(); return;
        }
        if (!spyDates || !spyValues || spyDates.length < 2 || spyValues.length < 2 || spyDates.length !== spyValues.length) {
            console.warn(`Insufficient or invalid SPY historical performance data.`);
            hidePopupChart(); return;
        }

        // Destroy previous chart instance if exists
        if (popupChartInstance) {
            popupChartInstance.destroy();
            popupChartInstance = null; // Clear reference
        }

        const isLightTheme = document.body.classList.contains('light-theme');
        const gridColor = isLightTheme ? 'rgba(0, 0, 0, 0.1)' : 'rgba(255, 255, 255, 0.1)';
        const textColor = isLightTheme ? '#333' : '#eee';
        const spyLineColor = 'rgba(150, 150, 150, 0.7)'; // Grey for SPY

        // Determine asset line color based on its overall trend
        const firstAssetValue = assetValues[0];
        const lastAssetValue = assetValues[assetValues.length - 1];
        const assetLineColor = lastAssetValue >= firstAssetValue ? 'rgba(76, 175, 80, 0.8)' : 'rgba(244, 67, 54, 0.8)'; // Green if up, red if down

        // --- Align SPY data to Asset dates using forward fill ---
        const spyValueMap = new Map(spyDates.map((date, i) => [date, spyValues[i]]));
        let currentSpyValue = null;
        let spyIndex = 0;
        const alignedSpyValues = assetDates.map(assetDate => {
            while (spyIndex < spyDates.length && spyDates[spyIndex] <= assetDate) {
                 currentSpyValue = spyValues[spyIndex];
                 spyIndex++;
            }
            return currentSpyValue;
        });
        // --- End Alignment ---

        popupChartInstance = new Chart(chartCanvas, {
            type: 'line',
            data: {
                labels: assetDates, // Use asset dates as primary labels
                datasets: [
                    {
                        label: `${stockData.display_name || stockData.name} Perf (%)`, // Asset line
                        data: assetValues,
                        borderColor: assetLineColor,
                        borderWidth: 1.5,
                        pointRadius: 0,
                        tension: 0.1
                    },
                    {
                        label: `SPY Perf (%)`, // SPY line
                        data: alignedSpyValues, // Use aligned data
                        borderColor: spyLineColor,
                        borderWidth: 1,
                        pointRadius: 0,
                        tension: 0.1,
                        borderDash: [4, 4] // Dashed line for SPY
                    }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                scales: {
                    x: {
                        display: false, // Hide x-axis labels/grid
                        ticks: { display: false },
                        grid: { display: false }
                    },
                    y: {
                        display: true, // Show y-axis for context
                        ticks: {
                            color: textColor,
                            font: { size: 10 },
                            maxTicksLimit: 5 // Limit number of ticks
                        },
                        grid: {
                            color: gridColor,
                            drawBorder: false
                        }
                    }
                },
                plugins: {
                    legend: {
                         display: true,
                         position: 'bottom', // MODIFIED: Legend at the bottom
                         align: 'center',
                         labels: {
                             boxWidth: 12,
                             font: { size: 10 },
                             color: textColor
                         }
                    },
                    tooltip: { enabled: true } // Enable tooltips for value inspection
                },
                animation: false // Disable animation for faster rendering on hover
            }
        });

        // --- Set Overlay Text ---
        const relPerfValue = stockData.relative_perf_1y;
        let timeframe = "1Y"; // Currently hardcoded, can be made dynamic if needed
        if (relPerfValue !== null && relPerfValue !== undefined) {
            const formattedPerf = formatNumber(relPerfValue);
            chartOverlayTextElement.textContent = `${timeframe} • Rel Perf: ${formattedPerf}%`;
            chartOverlayTextElement.className = `chart-overlay ${relPerfValue >= 0 ? 'positive' : 'negative'}`;
        } else {
            chartOverlayTextElement.textContent = `${timeframe} • Rel Perf: N/A`;
            chartOverlayTextElement.className = 'chart-overlay';
        }
        // --- End Overlay Text ---


        // Position and show the chart
        positionPopup(event);
        popupChartContainer.style.display = 'block';
    }

    // Function to show the RSI chart
    function showRsiChart(event, stockData) {
        hidePopupChart(); // Hide any existing chart first

        // --- Data Validation ---
        if (!popupChartContainer || !chartCanvas || !chartOverlayTextElement || !stockData || stockData.error) {
            return;
        }
        const rsiDates = stockData.rsi_1y_history_dates;
        const rsiValues = stockData.rsi_1y_history_values;

        if (!rsiDates || !rsiValues || rsiDates.length < 2 || rsiValues.length < 2 || rsiDates.length !== rsiValues.length) {
            console.warn(`Insufficient or invalid RSI historical data for ${stockData.name}`);
            chartOverlayTextElement.textContent = 'RSI Data N/A';
            chartOverlayTextElement.className = 'chart-overlay';
            positionPopup(event);
            popupChartContainer.style.display = 'block';
             if (popupChartInstance) {
                 popupChartInstance.destroy();
                 popupChartInstance = null;
             }
            return;
        }
        // --- End Data Validation ---


        // Destroy previous chart instance if exists
        if (popupChartInstance) {
            popupChartInstance.destroy();
            popupChartInstance = null;
        }

        const isLightTheme = document.body.classList.contains('light-theme');
        const gridColor = isLightTheme ? 'rgba(0, 0, 0, 0.1)' : 'rgba(255, 255, 255, 0.1)';
        const textColor = isLightTheme ? '#333' : '#eee';
        const rsiLineColor = isLightTheme ? 'rgba(0, 100, 200, 0.8)' : 'rgba(100, 180, 255, 0.8)';
        const oversoldColor = 'rgba(76, 175, 80, 0.5)';
        const overboughtColor = 'rgba(244, 67, 54, 0.5)';

        popupChartInstance = new Chart(chartCanvas, {
            type: 'line',
            data: {
                labels: rsiDates,
                datasets: [{
                    label: 'RSI (14)',
                    data: rsiValues,
                    borderColor: rsiLineColor,
                    borderWidth: 1.5,
                    pointRadius: 0,
                    tension: 0.1
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                scales: {
                    x: {
                        display: false,
                        ticks: { display: false },
                        grid: { display: false }
                    },
                    y: {
                        display: true,
                        min: 0,
                        max: 100,
                        ticks: {
                            color: textColor,
                            font: { size: 10 },
                            stepSize: 10,
                            callback: function(value, index, values) {
                                if (value === 30 || value === 70 || value === 0 || value === 50 || value === 100) {
                                    return value;
                                }
                                return null;
                            }
                        },
                        grid: {
                            color: gridColor,
                            drawBorder: false,
                            drawOnChartArea: true,
                            lineWidth: (context) => (context.tick.value === 30 || context.tick.value === 70 ? 1 : 0),
                            color: (context) => (context.tick.value === 30 ? oversoldColor : (context.tick.value === 70 ? overboughtColor : gridColor)),
                        }
                    }
                },
                plugins: {
                    legend: { display: false },
                    tooltip: { enabled: true }
                },
                animation: false
            }
        });

        // --- Set Overlay Text ---
        const currentRsi = stockData.rsi14;
        if (currentRsi !== null && currentRsi !== undefined) {
            const formattedRsi = formatNumber(currentRsi);
            chartOverlayTextElement.textContent = `RSI: ${formattedRsi}`;
            let rsiClass = '';
            if (currentRsi < 30) rsiClass = 'positive';
            else if (currentRsi > 70) rsiClass = 'negative';
            chartOverlayTextElement.className = `chart-overlay ${rsiClass}`;
        } else {
            chartOverlayTextElement.textContent = 'RSI: N/A';
            chartOverlayTextElement.className = 'chart-overlay';
        }
        // --- End Overlay Text ---

        // Position and show the chart
        positionPopup(event);
        popupChartContainer.style.display = 'block';
    }

    // Function to show the EMA chart (short-term: 13/21, long-term: 100/200)
    function showEmaChart(event, stockData, emaType = 'short') {
        hidePopupChart();

        if (!popupChartContainer || !chartCanvas || !chartOverlayTextElement || !stockData || stockData.error) {
            return;
        }

        // --- Data selection based on emaType ---
        const isLightTheme = document.body.classList.contains('light-theme');
        const allDates = stockData.ema_1y_history_dates;
        let ema1Values, ema2Values, ema1Label, ema2Label, signal, signalLabelText, ema1ColorTheme, ema2ColorTheme;

        if (emaType === 'short') {
            ema1Values = stockData.ema13_1y_history_values;
            ema2Values = stockData.ema21_1y_history_values;
            ema1Label = 'EMA 13';
            ema2Label = 'EMA 21';
            signal = stockData.ema_signal || 'Neutral';
            signalLabelText = 'EMA Short Signal';
            ema1ColorTheme = isLightTheme ? 'rgba(0, 150, 136, 0.8)' : 'rgba(77, 182, 172, 0.8)';
            ema2ColorTheme = isLightTheme ? 'rgba(255, 87, 34, 0.8)' : 'rgba(255, 138, 101, 0.8)';
        } else if (emaType === 'long') {
            ema1Values = stockData.ema50_1y_history_values;
            ema2Values = stockData.ema200_1y_history_values;
            ema1Label = 'EMA 50';
            ema2Label = 'EMA 200';
            signal = stockData.ema_long_signal || 'Neutral';
            signalLabelText = 'EMA Long Signal';
            ema1ColorTheme = isLightTheme ? 'rgba(63, 81, 181, 0.8)' : 'rgba(121, 134, 203, 0.8)';
            ema2ColorTheme = isLightTheme ? 'rgba(233, 30, 99, 0.8)' : 'rgba(240, 98, 146, 0.8)';
        } else {
            console.error("Invalid emaType for showEmaChart:", emaType);
            hidePopupChart();
            return;
        }

        if (!allDates || !ema1Values || !ema2Values || allDates.length < 2) {
            console.warn(`Insufficient or invalid ${emaType} EMA historical data for ${stockData.name}`);
            chartOverlayTextElement.textContent = `${emaType.toUpperCase()} EMA Data N/A`;
            chartOverlayTextElement.className = 'chart-overlay';
            positionPopup(event);
            popupChartContainer.style.display = 'block';
             if (popupChartInstance) {
                 popupChartInstance.destroy();
                 popupChartInstance = null;
             }
            return;
        }
        
        let chartDates, chartEma1Values, chartEma2Values, timeframe;

        if (emaType === 'short') {
            const sixMonthsDataPoints = 126; // Approx. 21 trading days/month * 6 months
            const startIndex = Math.max(0, allDates.length - sixMonthsDataPoints);
            chartDates = allDates.slice(startIndex);
            chartEma1Values = ema1Values.slice(startIndex);
            chartEma2Values = ema2Values.slice(startIndex);
            timeframe = "6M";
        } else { // For 'long' emaType
            chartDates = allDates;
            chartEma1Values = ema1Values;
            chartEma2Values = ema2Values;
            timeframe = "1Y";
        }
        
        if (chartDates.length < 2) {
            console.warn(`Not enough data for a ${timeframe} EMA chart for ${stockData.name}`);
            hidePopupChart();
            return;
        }

        if (popupChartInstance) {
            popupChartInstance.destroy();
            popupChartInstance = null;
        }

        const gridColor = isLightTheme ? 'rgba(0, 0, 0, 0.1)' : 'rgba(255, 255, 255, 0.1)';
        const textColor = isLightTheme ? '#333' : '#eee';

        popupChartInstance = new Chart(chartCanvas, {
            type: 'line',
            data: {
                labels: chartDates,
                datasets: [
                    {
                        label: ema1Label,
                        data: chartEma1Values,
                        borderColor: ema1ColorTheme,
                        borderWidth: 1.5,
                        pointRadius: 0,
                        tension: 0.1
                    },
                    {
                        label: ema2Label,
                        data: chartEma2Values,
                        borderColor: ema2ColorTheme,
                        borderWidth: 1.5,
                        pointRadius: 0,
                        tension: 0.1
                    }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                scales: {
                    x: {
                        display: false,
                        ticks: { display: false },
                        grid: { display: false }
                    },
                    y: {
                        display: true,
                        ticks: {
                            color: textColor,
                            font: { size: 10 },
                            maxTicksLimit: 5
                        },
                        grid: {
                            color: gridColor,
                            drawBorder: false
                        }
                    }
                },
                plugins: {
                    legend: {
                         display: true,
                         position: 'bottom',
                         align: 'center',
                         labels: {
                             boxWidth: 12,
                             font: { size: 10 },
                             color: textColor
                         }
                    },
                    tooltip: { enabled: true }
                },
                animation: false
            }
        });

        chartOverlayTextElement.textContent = `${timeframe} • ${signalLabelText}: ${signal}`;
        let signalClass = '';
        if (signal === 'Buy') signalClass = 'positive';
        else if (signal === 'Sell') signalClass = 'negative';
        chartOverlayTextElement.className = `chart-overlay ${signalClass}`;

        positionPopup(event);
        popupChartContainer.style.display = 'block';
    }


    // Function to show the Drawdown chart
    function showDrawdownChart(event, stockData) {
        hidePopupChart();

        if (!popupChartContainer || !chartCanvas || !chartOverlayTextElement || !stockData || stockData.error) {
            return;
        }
        const drawdownDates = stockData.drawdown_history_dates;
        const drawdownValues = stockData.drawdown_history_values;

        if (!drawdownDates || !drawdownValues || drawdownDates.length < 2 || drawdownValues.length < 2 || drawdownDates.length !== drawdownValues.length) {
            console.warn(`Insufficient or invalid Drawdown historical data for ${stockData.name}`);
            chartOverlayTextElement.textContent = 'Drawdown Data N/A';
            chartOverlayTextElement.className = 'chart-overlay';
            positionPopup(event);
            popupChartContainer.style.display = 'block';
             if (popupChartInstance) {
                 popupChartInstance.destroy();
                 popupChartInstance = null;
             }
            return;
        }

        if (popupChartInstance) {
            popupChartInstance.destroy();
            popupChartInstance = null;
        }

        const isLightTheme = document.body.classList.contains('light-theme');
        const gridColor = isLightTheme ? 'rgba(0, 0, 0, 0.1)' : 'rgba(255, 255, 255, 0.1)';
        const textColor = isLightTheme ? '#333' : '#eee';
        const drawdownColor = isLightTheme ? 'rgba(156, 39, 176, 0.8)' : 'rgba(186, 104, 200, 0.8)';

        const minValue = Math.min(0, ...drawdownValues);
        const suggestedMin = Math.floor(minValue / 10) * 10;

        popupChartInstance = new Chart(chartCanvas, {
            type: 'line',
            data: {
                labels: drawdownDates,
                datasets: [{
                    label: 'Drawdown %',
                    data: drawdownValues,
                    borderColor: drawdownColor,
                    backgroundColor: drawdownColor.replace('0.8', '0.2'),
                    borderWidth: 1.5,
                    pointRadius: 0,
                    tension: 0.1,
                    fill: true
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                scales: {
                    x: {
                        display: false,
                        ticks: { display: false },
                        grid: { display: false }
                    },
                    y: {
                        display: true,
                        suggestedMin: suggestedMin,
                        max: 0,
                        ticks: {
                            color: textColor,
                            font: { size: 10 },
                            maxTicksLimit: 5,
                            callback: function(value) {
                                return value + '%';
                            }
                        },
                        grid: {
                            color: gridColor,
                            drawBorder: false
                        }
                    }
                },
                plugins: {
                    legend: { display: false },
                    tooltip: {
                        enabled: true,
                        callbacks: {
                            label: function(context) {
                                let label = context.dataset.label || '';
                                if (label) {
                                    label += ': ';
                                }
                                if (context.parsed.y !== null) {
                                    label += formatNumber(context.parsed.y) + '%';
                                }
                                return label;
                            }
                        }
                    }
                },
                animation: false
            }
        });

        const currentDrawdown = stockData.current_drawdown_pct;
        chartOverlayTextElement.textContent = `Drawdown: ${formatNumber(currentDrawdown)}%`;
        chartOverlayTextElement.className = `chart-overlay ${currentDrawdown < 0 ? 'negative' : ''}`;

        positionPopup(event);
        popupChartContainer.style.display = 'block';
    }


    function hidePopupChart() {
        if (popupChartContainer) {
            popupChartContainer.style.display = 'none';
        }
    }

    function positionPopup(event) {
        if (!popupChartContainer) return;

        const cell = event.target.closest('td');
        if (!cell) return;

        const cellRect = cell.getBoundingClientRect();
        const containerRect = popupChartContainer.getBoundingClientRect();
        const containerWidth = containerRect.width || 350;
        const containerHeight = containerRect.height || 200;

        const viewportWidth = window.innerWidth;
        const viewportHeight = window.innerHeight;
        const scrollX = window.scrollX;
        const scrollY = window.scrollY;
        const padding = 10;

        let top = cellRect.bottom + scrollY + 2;
        let left = cellRect.left + scrollX;

        if (top + containerHeight > viewportHeight + scrollY - padding) {
            top = cellRect.top + scrollY - containerHeight - 2;
            if (top < scrollY + padding) {
                top = scrollY + padding;
            }
        }
         if (top < scrollY + padding) {
             top = scrollY + padding;
         }

        if (left + containerWidth > viewportWidth + scrollX - padding) {
            left = cellRect.right + scrollX - containerWidth;
            if (left + containerWidth > viewportWidth + scrollX - padding) {
                 left = viewportWidth + scrollX - containerWidth - padding;
            }
        }

        if (left < scrollX + padding) {
            left = scrollX + padding;
        }

        popupChartContainer.style.top = `${top}px`;
        popupChartContainer.style.left = `${left}px`;
    }


    // --- Theme Handling ---
    function applyTheme(isLight) {
        document.body.classList.toggle('light-theme', isLight);
        document.body.classList.toggle('dark-theme', !isLight);
    }

    // --- Update Sort Indicators ---
    function updateSortIndicators() {
        document.querySelectorAll('#stock-table thead th').forEach(th => {
            th.classList.remove('sort-asc', 'sort-desc');
            if (th.dataset.sort === sortColumn) {
                th.classList.add(sortDirection === 'asc' ? 'sort-asc' : 'sort-desc');
            }
        });
    }

    // --- Local Storage Functions ---
    function saveDataToLocalStorage() {
        try {
            const dataToStore = {
                marketData: currentMarketData,
                assetData: currentAssetData,
                spyHistory: spyHistoryData,
                timestamp: Date.now()
            };
            localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(dataToStore));
            console.log("Data saved to localStorage");
        } catch (e) {
            console.error("Error saving data to localStorage:", e);
        }
    }

    function loadDataFromLocalStorage() {
        console.log("loadDataFromLocalStorage: Attempting to load...");
        try {
            const storedDataString = localStorage.getItem(LOCAL_STORAGE_KEY);
            console.log("loadDataFromLocalStorage: Raw data string:", storedDataString ? storedDataString.substring(0, 100) + '...' : 'null');

            if (storedDataString) {
                const storedData = JSON.parse(storedDataString);
                console.log("loadDataFromLocalStorage: Parsed data:", storedData);

                currentMarketData = storedData.marketData || {};
                currentAssetData = storedData.assetData || [];
                spyHistoryData = storedData.spyHistory || null;
                console.log("loadDataFromLocalStorage: Successfully loaded and assigned data.");
                return true;
            } else {
                console.log("loadDataFromLocalStorage: No data found in localStorage.");
            }
        } catch (e) {
            console.error("loadDataFromLocalStorage: Error loading or parsing data:", e);
            localStorage.removeItem(LOCAL_STORAGE_KEY);
        }
        console.log("loadDataFromLocalStorage: Returning false.");
        return false;
    }

    // --- Event Listeners Setup ---
    function setupEventListeners() {
        console.log("Setting up event listeners...");

        if (refreshButton) {
            refreshButton.addEventListener('click', () => {
                fetchAndRenderData();
                clearInterval(updateInterval);
                updateInterval = setInterval(fetchAndRenderData, REFRESH_INTERVAL_MS);
            });
        }

        if (drawdownPeriodSelect) drawdownPeriodSelect.addEventListener('change', fetchAndRenderData);
        if (changePeriodSelect) changePeriodSelect.addEventListener('change', fetchAndRenderData);

        if (themeToggle) {
            themeToggle.addEventListener('click', () => {
                const isLight = document.body.classList.toggle('light-theme');
                localStorage.setItem('theme', isLight ? 'light' : 'dark');
                applyTheme(isLight);
                if (popupChartContainer && popupChartContainer.style.display === 'block') {
                     hidePopupChart();
                }
            });
        }

        document.querySelectorAll('#stock-table thead th[data-sort-key]').forEach(header => {
            header.addEventListener('click', () => {
                const newSortColumn = header.dataset.sortKey;
                if (sortColumn === newSortColumn) {
                    sortDirection = sortDirection === 'asc' ? 'desc' : 'asc';
                } else {
                    sortColumn = newSortColumn;
                    sortDirection = 'asc';
                }
                renderTable();
            });
        });

        if (stockTableBody) {
             stockTableBody.addEventListener('mouseout', (event) => {
                const relatedTarget = event.relatedTarget;
                if (popupChartContainer && !stockTableBody.contains(relatedTarget) && !popupChartContainer.contains(relatedTarget)) {
                    hidePopupChart();
                }
            });
        }

        document.addEventListener('visibilitychange', () => {
            if (document.hidden) {
                console.log("Tab hidden, clearing refresh interval.");
                clearInterval(updateInterval);
            } else {
                console.log("Tab visible, fetching data and restarting interval.");
                fetchAndRenderData();
                updateInterval = setInterval(fetchAndRenderData, REFRESH_INTERVAL_MS);
            }
        });

        console.log("Event listeners setup complete.");
    }

    // --- Initialization Logic ---
    console.log("Applying saved theme (if any)...");
    const savedTheme = localStorage.getItem('theme');
    if (savedTheme) {
        applyTheme(savedTheme === 'light');
    } else {
        const prefersLight = window.matchMedia('(prefers-color-scheme: light)').matches;
        applyTheme(prefersLight);
    }
    console.log("Theme application logic complete.");

    setupEventListeners();

    console.log("Initial Load: Starting check for cached data...");
    const hasCachedData = loadDataFromLocalStorage();
    console.log("Initial Load: Result of loadDataFromLocalStorage:", hasCachedData);

    if (hasCachedData) {
        console.log("Initial Load: Cached data found. Rendering synchronously...");
        // Check if cached data is too old (more than 10 minutes)
        const cachedTimestamp = JSON.parse(localStorage.getItem(LOCAL_STORAGE_KEY))?.timestamp || 0;
        const cacheAge = Date.now() - cachedTimestamp;
        const MAX_CACHE_AGE = 10 * 60 * 1000; // 10 minutes
        
        if (cacheAge > MAX_CACHE_AGE) {
            console.log(`Initial Load: Cached data is too old (${Math.round(cacheAge/1000/60)} minutes). Fetching fresh data.`);
            isInitialLoad = true;
            fetchAndRenderData();
        } else {
            isInitialLoad = false;
            try {
                renderTable();
                console.log("Initial Load: Synchronous render complete. Scheduling background refresh.");
                // Immediate background refresh
                setTimeout(fetchAndRenderData, 100);
            } catch (renderError) {
                console.error("Initial Load: Error during synchronous render from cache:", renderError);
                isInitialLoad = true;
                fetchAndRenderData();
            }
        }
    } else {
        console.log("Initial Load: No cached data. Performing initial fetch...");
        isInitialLoad = true;
        fetchAndRenderData();
    }

    console.log("Initial Load: Setting up auto-refresh interval.");
    updateInterval = setInterval(fetchAndRenderData, REFRESH_INTERVAL_MS);

    console.log("Initial Load: Setup complete.");
}

// --- Attach the main initialization function to DOMContentLoaded ---
document.addEventListener('DOMContentLoaded', initializeDashboard);

console.log("Script file loaded and DOMContentLoaded listener attached.");