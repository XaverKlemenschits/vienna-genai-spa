# Portfolio Optimiser

This WebApp takes a number of tickers as input and then uses past data to balance a given portfolio using the input tickers.

## Usage

Users have to enter their own API keys to access required ressources:
- Twelve Data
- OpenRouter

The entered API keys can be saved in the browser cache so they do not have to be entered each time.

## How it works

There are two ways which are used to calculate the ratio of each stock in the portfolio:
- Inverse volatility to favour stocks with lower volatility
- Weighted by Sharpe ratio

A pie chart shows how much of the investment should be allocated to each stock.
Below that a correlation matrix shows how closely related each of the stocks are.
