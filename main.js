// Portfolio Optimiser - Multi-ticker analysis with inverse volatility and Sharpe ratio weighting
import { Chart, PieController, ArcElement, Tooltip, Legend } from 'chart.js';

// Register Chart.js components
Chart.register(PieController, ArcElement, Tooltip, Legend);

const form = document.getElementById('ticker-form');
const results = document.getElementById('results');
const loadingElement = document.getElementById('loading');

// API key storage keys
const TWELVE_DATA_KEY_STORAGE = 'twelveDataApiKey';
const OPEN_ROUTER_KEY_STORAGE = 'openRouterApiKey';

// Load saved API keys on page load
document.addEventListener('DOMContentLoaded', () => {
  const twelveDataKey = localStorage.getItem(TWELVE_DATA_KEY_STORAGE);
  const openRouterKey = localStorage.getItem(OPEN_ROUTER_KEY_STORAGE);
  
  if (twelveDataKey) {
    document.getElementById('twelvedata-key').value = twelveDataKey;
  }
  if (openRouterKey) {
    document.getElementById('openrouter-key').value = openRouterKey;
  }
});

// Save API keys to localStorage when fields lose focus (more efficient than saving on every keystroke)
const twelveDataInput = document.getElementById('twelvedata-key');
const openRouterInput = document.getElementById('openrouter-key');

twelveDataInput.addEventListener('blur', () => {
  localStorage.setItem(TWELVE_DATA_KEY_STORAGE, twelveDataInput.value.trim());
});

openRouterInput.addEventListener('blur', () => {
  localStorage.setItem(OPEN_ROUTER_KEY_STORAGE, openRouterInput.value.trim());
});

form.addEventListener('submit', async (event) => {
  event.preventDefault();

  const tickerInput = document.getElementById('ticker').value.trim();
  const twelveDataKey = document.getElementById('twelvedata-key').value.trim();
  
  // Save API keys to localStorage
  if (twelveDataKey) {
    localStorage.setItem(TWELVE_DATA_KEY_STORAGE, twelveDataKey);
  }
  
  const openRouterKey = document.getElementById('openrouter-key').value.trim();
  if (openRouterKey) {
    localStorage.setItem(OPEN_ROUTER_KEY_STORAGE, openRouterKey);
  }

  // Validate ticker input
  if (!tickerInput) {
    results.innerHTML = '<p class="error">Please enter at least one ticker symbol.</p>';
    return;
  }

  if (!twelveDataKey) {
    results.innerHTML = '<p class="error">Please enter your Twelve Data API key.</p>';
    return;
  }

  // Parse tickers (comma-separated, trim whitespace, uppercase)
  const tickers = tickerInput.split(',')
    .map(t => t.trim().toUpperCase())
    .filter(t => t.length > 0);

  if (tickers.length === 0) {
    results.innerHTML = '<p class="error">Please enter valid ticker symbols.</p>';
    return;
  }

  if (tickers.length > 10) {
    results.innerHTML = '<p class="error">Please limit to 10 tickers or fewer.</p>';
    return;
  }

  // Show loading state
  results.innerHTML = '';
  loadingElement.style.display = 'block';
  document.querySelector('.placeholder')?.remove();

  try {
    // Fetch price data for all tickers in parallel
    const priceDataMap = await fetchMultipleTickersPriceData(tickers, twelveDataKey);
    
    // Calculate portfolio metrics
    const portfolioData = calculatePortfolioMetrics(priceDataMap, tickers);
    
    // Calculate correlation matrix
    const correlationMatrix = calculateCorrelationMatrix(priceDataMap, tickers);
    
    // Render results
    renderResults(tickers, priceDataMap, portfolioData, correlationMatrix);
    
  } catch (err) {
    results.innerHTML = `<p class="error">Error: ${err.message}</p>`;
    console.error('Portfolio optimisation error:', err);
  } finally {
    loadingElement.style.display = 'none';
  }
});

/**
 * Fetch price data for multiple tickers concurrently
 * @param {string[]} tickers - Array of ticker symbols
 * @param {string} apiKey - Twelve Data API key
 * @returns {Promise<Object>} - Map of ticker to price data
 */
async function fetchMultipleTickersPriceData(tickers, apiKey) {
  const promises = tickers.map(ticker => 
    fetchPriceData(ticker, apiKey)
      .then(data => ({ ticker, data, error: null }))
      .catch(err => ({ ticker, data: null, error: err.message }))
  );

  const results = await Promise.all(promises);
  
  const priceDataMap = {};
  const failedTickers = [];
  
  for (const result of results) {
    if (result.error) {
      console.warn(`Failed to fetch data for ${result.ticker}: ${result.error}`);
      failedTickers.push(result.ticker);
    } else {
      priceDataMap[result.ticker] = result.data;
    }
  }
  
  if (failedTickers.length > 0) {
    console.warn(`Failed to fetch data for: ${failedTickers.join(', ')}`);
    // If all tickers failed, throw an error
    if (Object.keys(priceDataMap).length === 0) {
      throw new Error(`Failed to fetch data for all tickers: ${failedTickers.join(', ')}`);
    }
  }
  
  return priceDataMap;
}

/**
 * Fetch price data for a single ticker from Twelve Data API
 * @param {string} ticker - Ticker symbol
 * @param {string} apiKey - Twelve Data API key
 * @returns {Promise<Object>} - Price data for the ticker
 */
async function fetchPriceData(ticker, apiKey) {
  // outputsize is the number of most-recent bars. ~90 trading days is about 3-4 months
  const url = `https://api.twelvedata.com/time_series?symbol=${ticker}&interval=1day&outputsize=90&apikey=${apiKey}`;
  const response = await fetch(url);

  // Read the body as text first, then parse it safely
  const body = await response.text();
  let raw;
  try {
    raw = JSON.parse(body);
  } catch {
    throw new Error(body.trim() || 'Price fetch failed');
  }

  // Twelve Data reports problems as { code, status: "error", message }.
  if (raw && raw.status === 'error') throw new Error(raw.message || 'Price fetch failed');
  if (!response.ok) throw new Error('Price fetch failed');

  // Successful responses look like { meta, values: [ { datetime, open, ... } ] },
  // newest first. Normalize to numbers and sort oldest to newest so indicator
  // math (moving averages, RSI, ...) reads left to right.
  const values = raw.values ?? [];
  if (!values.length) throw new Error(`No price data returned for ${ticker}`);

  return values
    .map((b) => ({
      date: b.datetime,
      open: Number(b.open),
      high: Number(b.high),
      low: Number(b.low),
      close: Number(b.close),
      volume: Number(b.volume)
    }))
    .sort((a, b) => (a.date < b.date ? -1 : 1));
}

/**
 * Calculate daily returns from price data
 * @param {Object[]} priceData - Array of price data objects with close prices
 * @returns {number[]} - Array of daily returns
 */
function calculateDailyReturns(priceData) {
  if (!priceData || priceData.length < 2) return [];
  
  const returns = [];
  for (let i = 1; i < priceData.length; i++) {
    const dailyReturn = (priceData[i].close - priceData[i-1].close) / priceData[i-1].close;
    returns.push(dailyReturn);
  }
  return returns;
}

/**
 * Calculate mean of an array of numbers
 * @param {number[]} values - Array of numbers
 * @returns {number} - Mean value
 */
function mean(values) {
  if (!values || values.length === 0) return 0;
  const sum = values.reduce((acc, val) => acc + val, 0);
  return sum / values.length;
}

/**
 * Calculate standard deviation (volatility) of an array of numbers
 * @param {number[]} values - Array of numbers
 * @returns {number} - Standard deviation
 */
function standardDeviation(values) {
  if (!values || values.length < 2) return 0;
  
  const avg = mean(values);
  const squaredDiffs = values.map(val => Math.pow(val - avg, 2));
  const variance = mean(squaredDiffs);
  return Math.sqrt(variance);
}

/**
 * Calculate covariance between two arrays of values
 * @param {number[]} returnsA - Array of returns for asset A
 * @param {number[]} returnsB - Array of returns for asset B
 * @returns {number} - Covariance
 */
function covariance(returnsA, returnsB) {
  if (!returnsA || !returnsB || returnsA.length === 0 || returnsB.length === 0) return 0;
  
  // Ensure both arrays have the same length
  const minLength = Math.min(returnsA.length, returnsB.length);
  const a = returnsA.slice(0, minLength);
  const b = returnsB.slice(0, minLength);
  
  const meanA = mean(a);
  const meanB = mean(b);
  
  let cov = 0;
  for (let i = 0; i < minLength; i++) {
    cov += (a[i] - meanA) * (b[i] - meanB);
  }
  
  return cov / minLength;
}

/**
 * Calculate Pearson correlation coefficient between two arrays
 * @param {number[]} returnsA - Array of returns for asset A
 * @param {number[]} returnsB - Array of returns for asset B
 * @returns {number} - Correlation coefficient (-1 to +1)
 */
function pearsonCorrelation(returnsA, returnsB) {
  if (!returnsA || !returnsB || returnsA.length < 2 || returnsB.length < 2) return 0;
  
  const minLength = Math.min(returnsA.length, returnsB.length);
  const a = returnsA.slice(0, minLength);
  const b = returnsB.slice(0, minLength);
  
  const stdDevA = standardDeviation(a);
  const stdDevB = standardDeviation(b);
  
  if (stdDevA === 0 || stdDevB === 0) return 0;
  
  const cov = covariance(a, b);
  return cov / (stdDevA * stdDevB);
}

/**
 * Calculate portfolio metrics for all tickers
 * @param {Object} priceDataMap - Map of ticker to price data
 * @param {string[]} tickers - Array of ticker symbols
 * @returns {Object} - Portfolio data with weights, volatility, Sharpe ratios
 */
function calculatePortfolioMetrics(priceDataMap, tickers) {
  const results = {
    tickers: [],
    volatility: {},
    meanReturns: {},
    sharpeRatios: {},
    inverseVolatilityWeights: {},
    sharpeRatioWeights: {}
  };

  // Calculate metrics for each ticker
  for (const ticker of tickers) {
    const priceData = priceDataMap[ticker];
    if (!priceData || priceData.length < 2) {
      console.warn(`Insufficient data for ${ticker}, skipping...`);
      continue;
    }

    const dailyReturns = calculateDailyReturns(priceData);
    const vol = standardDeviation(dailyReturns);
    const meanReturn = mean(dailyReturns);
    
    // Calculate Sharpe ratio (assuming risk-free rate = 0)
    const sharpeRatio = vol > 0 ? meanReturn / vol : 0;
    
    results.tickers.push(ticker);
    results.volatility[ticker] = vol;
    results.meanReturns[ticker] = meanReturn;
    results.sharpeRatios[ticker] = sharpeRatio;
  }

  // Calculate inverse volatility weights (normalize to sum to 1)
  const inverseVolWeights = {};
  let sumInverseVol = 0;
  
  for (const ticker of results.tickers) {
    const vol = results.volatility[ticker];
    // Handle zero volatility by adding a small epsilon
    const safeVol = Math.max(vol, 0.0001);
    inverseVolWeights[ticker] = 1 / safeVol;
    sumInverseVol += inverseVolWeights[ticker];
  }
  
  for (const ticker of results.tickers) {
    results.inverseVolatilityWeights[ticker] = sumInverseVol > 0 ? 
      inverseVolWeights[ticker] / sumInverseVol : 0;
  }

  // Calculate Sharpe ratio weights (normalize to sum to 1)
  const sharpeWeights = {};
  let sumSharpe = 0;
  
  for (const ticker of results.tickers) {
    const sharpe = results.sharpeRatios[ticker];
    // Use absolute value or max(0, sharpe) to avoid negative weights
    sharpeWeights[ticker] = Math.max(0, sharpe);
    sumSharpe += sharpeWeights[ticker];
  }
  
  for (const ticker of results.tickers) {
    results.sharpeRatioWeights[ticker] = sumSharpe > 0 ? 
      sharpeWeights[ticker] / sumSharpe : 0;
  }

  return results;
}

/**
 * Calculate correlation matrix for all ticker pairs
 * @param {Object} priceDataMap - Map of ticker to price data
 * @param {string[]} tickers - Array of ticker symbols
 * @returns {Object} - Correlation matrix
 */
function calculateCorrelationMatrix(priceDataMap, tickers) {
  const matrix = {};
  const returnsMap = {};
  
  // Calculate daily returns for each ticker
  for (const ticker of tickers) {
    const priceData = priceDataMap[ticker];
    if (priceData && priceData.length >= 2) {
      returnsMap[ticker] = calculateDailyReturns(priceData);
    } else {
      returnsMap[ticker] = [];
    }
  }

  // Calculate correlation for each pair
  for (const tickerA of tickers) {
    matrix[tickerA] = {};
    for (const tickerB of tickers) {
      const returnsA = returnsMap[tickerA];
      const returnsB = returnsMap[tickerB];
      
      const corr = pearsonCorrelation(returnsA, returnsB);
      // Clamp to [-1, 1] range due to floating point precision
      matrix[tickerA][tickerB] = Math.max(-1, Math.min(1, corr));
    }
  }

  return matrix;
}

/**
 * Render portfolio results including charts and correlation matrix
 * @param {string[]} tickers - Array of ticker symbols
 * @param {Object} priceDataMap - Map of ticker to price data
 * @param {Object} portfolioData - Portfolio metrics
 * @param {Object} correlationMatrix - Correlation matrix
 */
function renderResults(tickers, priceDataMap, portfolioData, correlationMatrix) {
  // Filter out tickers with no data
  const validTickers = portfolioData.tickers;
  
  if (validTickers.length === 0) {
    results.innerHTML = '<p class="error">No valid ticker data available for analysis.</p>';
    return;
  }

  // Create chart data for inverse volatility
  const inverseVolData = {
    labels: validTickers,
    datasets: [{
      data: validTickers.map(t => portfolioData.inverseVolatilityWeights[t]),
      backgroundColor: generateColors(validTickers.length),
      borderWidth: 1
    }]
  };

  // Create chart data for Sharpe ratio
  const sharpeData = {
    labels: validTickers,
    datasets: [{
      data: validTickers.map(t => portfolioData.sharpeRatioWeights[t]),
      backgroundColor: generateColors(validTickers.length),
      borderWidth: 1
    }]
  };

  // Destroy existing charts if they exist
  const existingCharts = Chart.instances;
  Object.keys(existingCharts).forEach(key => {
    existingCharts[key].destroy();
  });

  // Create new charts
  const inverseVolCtx = document.getElementById('inverse-volatility-chart');
  const sharpeCtx = document.getElementById('sharpe-ratio-chart');

  if (inverseVolCtx && sharpeCtx) {
    new Chart(inverseVolCtx, {
      type: 'pie',
      data: inverseVolData,
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: {
            position: 'right',
            labels: {
              color: '#d4d4d4',
              padding: 10,
              font: {
                size: 11,
                family: 'Segoe UI, Roboto, sans-serif'
              }
            }
          },
          tooltip: {
            callbacks: {
              label: function(context) {
                const label = context.label || '';
                const value = context.raw || 0;
                return `${label}: ${(value * 100).toFixed(2)}%`;
              }
            }
          }
        },
        animation: {
          animateScale: true,
          animateRotate: true
        }
      }
    });

    new Chart(sharpeCtx, {
      type: 'pie',
      data: sharpeData,
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: {
            position: 'right',
            labels: {
              color: '#d4d4d4',
              padding: 10,
              font: {
                size: 11,
                family: 'Segoe UI, Roboto, sans-serif'
              }
            }
          },
          tooltip: {
            callbacks: {
              label: function(context) {
                const label = context.label || '';
                const value = context.raw || 0;
                return `${label}: ${(value * 100).toFixed(2)}%`;
              }
            }
          }
        },
        animation: {
          animateScale: true,
          animateRotate: true
        }
      }
    });
  }

  // Render correlation matrix
  const correlationHtml = renderCorrelationMatrix(correlationMatrix, validTickers);

  // Build results HTML
  let html = '<div class="portfolio-summary">';
  html += '<h3>Portfolio Summary</h3>';
  html += `<p><strong>Tickers Analyzed:</strong> ${validTickers.join(', ')}</p>`;
  
  if (validTickers.length < tickers.length) {
    const failed = tickers.filter(t => !validTickers.includes(t));
    html += `<p class="error">Could not retrieve data for: ${failed.join(', ')}</p>`;
  }
  html += '</div>';
  
  // Add allocation tables
  html += '<div class="allocation-tables">';
  html += '<h3>Portfolio Allocation Percentages</h3>';
  
  // Inverse Volatility Allocation table
  html += '<div class="allocation-table">';
  html += '<h4>Inverse Volatility Weights</h4>';
  html += '<table class="prices-table">';
  html += '<thead><tr><th>Ticker</th><th>Allocation %</th></tr></thead><tbody>';
  
  for (const ticker of validTickers) {
    const weight = (portfolioData.inverseVolatilityWeights[ticker] * 100).toFixed(2);
    html += `<tr><td><strong>${ticker}</strong></td><td>${weight}%</td></tr>`;
  }
  
  html += '</tbody></table>';
  html += '</div>';
  
  // Sharpe Ratio Allocation table
  html += '<div class="allocation-table">';
  html += '<h4>Sharpe Ratio Weights</h4>';
  html += '<table class="prices-table">';
  html += '<thead><tr><th>Ticker</th><th>Allocation %</th></tr></thead><tbody>';
  
  for (const ticker of validTickers) {
    const weight = (portfolioData.sharpeRatioWeights[ticker] * 100).toFixed(2);
    html += `<tr><td><strong>${ticker}</strong></td><td>${weight}%</td></tr>`;
  }
  
  html += '</tbody></table>';
  html += '</div>';
  html += '</div>';

  // Add latest prices
  html += '<div class="latest-prices">';
  html += '<h3>Latest Prices & Metrics</h3>';
  html += '<table class="prices-table">';
  html += '<thead><tr><th>Ticker</th><th>Latest Close</th><th>Volatility</th><th>Mean Return</th><th>Sharpe Ratio</th></tr></thead>';
  html += '<tbody>';
  
  for (const ticker of validTickers) {
    const priceData = priceDataMap[ticker];
    const latestPrice = priceData && priceData.length > 0 ? 
      priceData[priceData.length - 1].close.toFixed(2) : 'N/A';
    const vol = (portfolioData.volatility[ticker] * 100).toFixed(4);
    const meanRet = (portfolioData.meanReturns[ticker] * 100).toFixed(4);
    const sharpe = portfolioData.sharpeRatios[ticker].toFixed(4);
    
    html += `<tr>
      <td><strong>${ticker}</strong></td>
      <td>$${latestPrice}</td>
      <td>${vol}%</td>
      <td>${meanRet}%</td>
      <td>${sharpe}</td>
    </tr>`;
  }
  
  html += '</tbody></table>';
  html += '</div>';

  // Build the final results content
  const finalHtml = `
    <div class="portfolio-results">
      <div class="chart-container">
        <h3>Inverse Volatility Allocation</h3>
        <canvas id="inverse-volatility-chart"></canvas>
      </div>
      
      <div class="chart-container">
        <h3>Sharpe Ratio Allocation</h3>
        <canvas id="sharpe-ratio-chart"></canvas>
      </div>
      
      <div class="correlation-container">
        <h3>Correlation Matrix</h3>
        <div id="correlation-matrix">${correlationHtml}</div>
      </div>
      
      ${html}
    </div>
  `;

  results.innerHTML = finalHtml;
}

/**
 * Render correlation matrix as an HTML table with heatmap coloring
 * @param {Object} matrix - Correlation matrix
 * @param {string[]} tickers - Array of ticker symbols
 * @returns {string} - HTML string for correlation matrix
 */
function renderCorrelationMatrix(matrix, tickers) {
  let html = '<table class="correlation-table">';
  html += '<thead><tr><th></th>';
  
  for (const ticker of tickers) {
    html += `<th>${ticker}</th>`;
  }
  
  html += '</tr></thead><tbody>';
  
  for (const tickerA of tickers) {
    html += `<tr><th>${tickerA}</th>`;
    
    for (const tickerB of tickers) {
      const corr = matrix[tickerA]?.[tickerB] ?? 0;
      const formattedCorr = corr.toFixed(2);
      const colorClass = getCorrelationColorClass(corr);
      
      html += `<td class="corr-cell ${colorClass}" title="${formattedCorr}">${formattedCorr}</td>`;
    }
    
    html += '</tr>';
  }
  
  html += '</tbody></table>';
  return html;
}

/**
 * Get CSS class for correlation value based on heatmap coloring
 * @param {number} correlation - Correlation value (-1 to 1)
 * @returns {string} - CSS class name
 */
function getCorrelationColorClass(correlation) {
  if (correlation >= 0.7) return 'corr-very-high';
  if (correlation >= 0.3) return 'corr-high';
  if (correlation >= -0.3) return 'corr-medium';
  if (correlation >= -0.7) return 'corr-low';
  return 'corr-very-low';
}

/**
 * Generate an array of colors for chart segments
 * @param {number} count - Number of colors needed
 * @returns {string[]} - Array of color strings
 */
function generateColors(count) {
  const colors = [
    '#FF6384', '#36A2EB', '#FFCE56', '#4BC0C0', '#9966FF',
    '#FF9F40', '#8AC24A', '#607D8B', '#E91E63', '#FFC107'
  ];
  
  const result = [];
  for (let i = 0; i < count; i++) {
    result.push(colors[i % colors.length]);
  }
  return result;
}