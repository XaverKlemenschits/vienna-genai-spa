# Portfolio Optimiser

A **Markowitz Mean-Variance Optimization** WebApp that calculates the optimal portfolio allocation for multiple stock tickers by maximizing the **Sharpe Ratio**. Built with pure JavaScript, HTML5, and CSS3 — no external libraries required.

## Features

- **Multi-Ticker Input**: Enter comma-separated ticker symbols (e.g., AAPL, MSFT, GOOGL, NVDA)
- **Portfolio Optimization**: Finds optimal asset weights that maximize Sharpe Ratio
- **Markowitz Framework**: Uses mean-variance optimization with no-short-selling constraints
- **Sharpe Ratio Maximization**: Optimizes for risk-adjusted returns using configurable risk-free rate
- **Data Alignment**: Automatically aligns all tickers to a common date range
- **Annualized Metrics**: Displays expected annual return, annual volatility, and Sharpe ratio
- **Visual Allocation**: Shows portfolio weights in both chart and table formats
- **AI Research Notes**: Optional integration with OpenRouter for AI-generated ticker analysis
- **Rate Limit Protection**: Batch processing to respect Twelve Data's free tier limits
- **API Key Management**: Save API keys to browser storage for convenience across sessions

## Usage

### Quick Start

1. **Save API Keys** (Optional): Click the ⚙️ settings button in the top-right to save your API keys to browser storage. They'll be available next time you visit.

### Prerequisites

You need API keys from two services:

1. **Twelve Data** (Required): Free API key for US stock price data
   - Sign up: [https://twelvedata.com/pricing](https://twelvedata.com/pricing)
   - Free tier: 8 requests/minute, 800/day (supports up to 8 tickers)
   - Covers all US stocks and ETFs

2. **OpenRouter** (Optional): For AI-generated research notes
   - Sign up: [https://openrouter.ai/](https://openrouter.ai/)
   - Required only if you want AI analysis for each ticker

### How to Use

1. **Enter Tickers**: Input comma-separated stock symbols (e.g., `AAPL, MSFT, GOOGL, NVDA`)
   - Maximum 8 tickers (due to Twelve Data free tier rate limits)
   - Supports any US stock or ETF symbol

2. **Set Risk-Free Rate**: Enter the annual risk-free rate for Sharpe ratio calculation
   - Default: 2% (typical US Treasury bill rate)
   - Adjust based on current market conditions

3. **Set Analysis Period**: Choose the historical time period for optimization
   - Range: 1-24 months
   - Default: 6 months
   - **Shorter periods** (1-3 months): More responsive to recent market conditions, but may be noisy
   - **Longer periods** (12-24 months): More stable correlations and statistics, but may miss recent trends

4. **Enter Twelve Data API Key**: Required for fetching price data

4. **Enter OpenRouter API Key** (Optional): For AI research notes

5. **Click "Optimize Portfolio"**: Runs the optimization and displays results

### Example Inputs

- **Tech Stocks**: `AAPL, MSFT, GOOGL, NVDA, AMZN, META`
- **Index Funds**: `SPY, QQQ, DIA, IWM`
- **Mixed Portfolio**: `AAPL, MSFT, TSLA, JPM, XOM, PG`

## How It Works

### Data Processing Pipeline

1. **Fetch Price Data**: Retrieves historical closing prices for each ticker based on the selected analysis period (1-24 months)
2. **Align Data**: Finds common dates across all tickers and aligns price series
3. **Calculate Returns**: Converts prices to daily percentage returns
4. **Compute Statistics**: Calculates mean returns and covariance matrix using the selected time period
5. **Optimize Portfolio**: Finds weights that maximize Sharpe Ratio
6. **Annualize Results**: Converts daily metrics to annual figures

### Portfolio Optimization

The app implements **Markowitz Mean-Variance Optimization** with the following objective:

**Maximize Sharpe Ratio:**
```
Sharpe Ratio = (R_p - R_f) / σ_p
```

Where:
- `R_p` = Portfolio expected return = Σ(wᵢ × μᵢ)
- `R_f` = Risk-free rate (user configurable)
- `σ_p` = Portfolio volatility = √(wᵀ × Σ × w)
- `wᵢ` = Weight of asset i (optimized)
- `μᵢ` = Expected return of asset i
- `Σ` = Covariance matrix

### Optimization Methods

The app uses different optimization approaches based on portfolio size:

- **Grid Search** (≤4 assets): Exhaustive search across all possible weight combinations
- **Random Search** (>4 assets): Stochastic optimization with local refinement

Both methods enforce:
- **No Short Selling**: All weights ≥ 0
- **Fully Invested**: Σ(weights) = 1
- **Non-Negative Returns**: Validates all calculations

### Annualization Formulas

- **Annual Return**: `(1 + daily_return)^252 - 1`
- **Annual Volatility**: `daily_volatility × √252`
- **Trading Days/Year**: 252 (US market standard)

## Results Interpretation

### Portfolio Summary

- **Number of Assets**: How many tickers were optimized
- **Expected Annual Return**: Projected portfolio return over 12 months
- **Annual Volatility**: Expected annual standard deviation of returns
- **Sharpe Ratio**: Risk-adjusted return (higher is better)
- **Risk-Free Rate**: User-specified benchmark rate
- **Total Weight**: Sum of all weights (should equal 100%)

### Optimal Allocation

- **Bar Chart**: Visual representation of each asset's weight
- **Table**: Detailed breakdown with percentage allocations
- **Sorted by Weight**: Highest allocation first for easy reading

### Data Statistics

- **Data Period**: Date range of the historical data used
- **Common Observations**: Number of overlapping data points across all tickers
- **Calculation Method**: Grid Search or Random Search (depends on portfolio size)

## Technical Details

### Optimization Constraints

```
Constraints:
- Σ wᵢ = 1 (fully invested)
- wᵢ ≥ 0 for all i (no short selling)
- Objective: Maximize (R_p - R_f) / σ_p
```

### Matrix Operations

The implementation includes custom matrix operations:
- Matrix multiplication
- Vector dot products
- Covariance matrix calculation
- Portfolio variance computation

### Performance Considerations

- **Grid Search**: O(n^(k-1)) where k = number of assets, n = grid steps
  - Limited to 4 assets for performance (20^3 = 8,000 combinations)
- **Random Search**: O(iterations × k^2) for matrix operations
  - 50,000 iterations for larger portfolios
  - Includes local refinement for improved accuracy

## File Structure

```
vienna-genai-spa/
├── index.html          # Main HTML with form and results display
├── main.js            # Portfolio optimization logic
├── style.css          # Styling for the application
└── README.md           # This file
```

### Key Functions (main.js)

- `fetchAllPriceData()`: Batch fetches price data for all tickers
- `alignPriceData()`: Aligns all tickers to common dates
- `calculateDailyReturns()`: Converts prices to returns
- `calculatePortfolioStatistics()`: Computes mean returns and covariance
- `optimizePortfolioSharpe()`: Main optimization entry point
- `evaluateWeights()`: Calculates metrics for given weights
- `annualizeReturn()` / `annualizeVolatility()`: Converts to annual figures
- `renderResults()`: Displays optimization results

## Limitations

- **Maximum 8 tickers**: Due to Twelve Data free tier rate limits
- **US Markets Only**: Twelve Data free tier covers US stocks/ETFs
- **Historical Data**: Limited to 200 data points per ticker
- **Browser-Based**: All calculations run in-browser (no server required)
- **Optimization Accuracy**: Grid search is exact for small portfolios; random search is approximate for larger ones

## Error Handling

The app handles various error conditions:
- Invalid or missing API keys
- Ticker symbols not found
- Insufficient price data (< 10 data points)
- Network or API rate limiting
- Invalid user inputs

## Browser Compatibility

- **Modern Browsers**: Chrome, Firefox, Safari, Edge (ES6+ support required)
- **Mobile**: Responsive design for tablets and phones
- **Requirements**: JavaScript enabled, internet connection for API calls, localStorage support for saving API keys

## Development Notes

### Adding Features

To extend this app, consider:
- **Efficient Frontier**: Plot risk-return tradeoffs for different risk levels
- **Constraint Options**: Allow short selling, weight limits, sector constraints
- **Rebalancing**: Add portfolio rebalancing frequency options
- **Transaction Costs**: Factor in trading costs for realistic optimization
- **Risk Measures**: Alternative metrics (Sortino Ratio, Maximum Drawdown)
- **Data Export**: Allow users to export results as CSV or JSON

### Performance Optimization

For larger portfolios or more sophisticated optimization:
- Implement matrix inversion for closed-form solutions
- Add gradient-based optimization methods
- Consider using Web Workers for intensive calculations
- Cache price data to reduce API calls

## Contributing

This is a standalone, zero-dependency implementation. Contributions that:
- Improve optimization accuracy
- Add new financial metrics
- Enhance the user interface
- Extend functionality while maintaining simplicity

are welcome.

## License

This project is provided as-is for educational purposes. See the original repository for licensing details.

## Credits

- **Portfolio Theory**: Harry Markowitz, Modern Portfolio Theory (1952)
- **Sharpe Ratio**: William F. Sharpe (1966)
- **Data**: [Twelve Data](https://twelvedata.com/)
- **AI**: [OpenRouter](https://openrouter.ai/) (optional)

## Privacy Note

- **API keys are stored only in your browser** using localStorage
- **No server storage**: Your API keys never leave your device
- **Browser-only**: All calculations and data processing happen in your browser
- **Security**: Keys are stored encrypted by your browser's security model