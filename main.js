// Portfolio Optimiser - Markowitz Mean-Variance Optimization with Sharpe Ratio maximization
// This file implements a complete portfolio optimization system that:
// 1. Accepts multiple tickers as input
// 2. Fetches price data for all tickers
// 3. Calculates daily returns and covariance matrix
// 4. Optimizes portfolio weights to maximize Sharpe ratio
// 5. Displays optimal allocation and portfolio metrics

const form = document.getElementById('ticker-form');
const results = document.getElementById('results');

// Constants
const TRADING_DAYS_PER_YEAR = 252;
const MAX_TICKERS = 8; // Due to Twelve Data free plan rate limits
const GRID_SEARCH_STEPS = 20; // For brute-force optimization of small portfolios

form.addEventListener('submit', async (event) => {
  event.preventDefault();

  const tickersInput = document.getElementById('tickers').value.trim().toUpperCase();
  const twelveDataKey = document.getElementById('twelvedata-key').value.trim();
  const openRouterKey = document.getElementById('openrouter-key').value.trim();
  const riskFreeRate = parseFloat(document.getElementById('risk-free-rate').value) || 2; // Default 2%

  // Parse comma-separated tickers
  const tickers = tickersInput.split(',')
    .map(t => t.trim().toUpperCase())
    .filter(t => t.length > 0);

  // Validate inputs
  if (tickers.length === 0) {
    results.innerHTML = '<p class="error">Please enter at least one ticker symbol.</p>';
    return;
  }

  if (tickers.length > MAX_TICKERS) {
    results.innerHTML = `<p class="error">Please limit to ${MAX_TICKERS} tickers due to API rate limits.</p>`;
    return;
  }

  if (!twelveDataKey) {
    results.innerHTML = '<p class="error">Twelve Data API key is required.</p>';
    return;
  }

  results.innerHTML = '<p>Fetching price data for all tickers... This may take a few moments.</p>';

  try {
    // Fetch price data for all tickers concurrently
    const allPriceData = await fetchAllPriceData(tickers, twelveDataKey);
    
    // Check if we have enough data points
    const minDataPoints = Math.min(...allPriceData.map(data => data.data.length));
    if (minDataPoints < 10) {
      results.innerHTML = '<p class="error">Insufficient price data. Need at least 10 data points for meaningful optimization.</p>';
      return;
    }

    // Align all tickers to common date range
    const alignedData = alignPriceData(allPriceData);
    
    // Calculate daily returns
    const returnsData = calculateDailyReturns(alignedData);
    
    // Calculate mean returns and covariance matrix
    const { meanReturns, covMatrix } = calculatePortfolioStatistics(returnsData);
    
    // Optimize portfolio to maximize Sharpe ratio
    const riskFreeRateDaily = riskFreeRate / 100 / TRADING_DAYS_PER_YEAR;
    const optimization = optimizePortfolioSharpe(meanReturns, covMatrix, riskFreeRateDaily, tickers);
    
    // Fetch AI research notes if OpenRouter key is provided
    let notes = {};
    if (openRouterKey) {
      results.innerHTML += '<p>Generating AI research notes...</p>';
      for (const ticker of tickers) {
        try {
          const priceData = allPriceData.find(d => d.ticker === ticker)?.data || [];
          if (priceData.length > 0) {
            notes[ticker] = await getResearchNote(ticker, priceData, openRouterKey);
          }
        } catch (err) {
          console.warn(`Failed to get research note for ${ticker}:`, err.message);
          notes[ticker] = 'Research note unavailable.';
        }
      }
    }
    
    // Render results
    renderResults(tickers, allPriceData, alignedData, returnsData, optimization, notes, riskFreeRate);
    
  } catch (err) {
    results.innerHTML = `<p class="error">Something went wrong: ${err.message}</p>`;
    console.error('Error:', err);
  }
});

// ============================================================================
// DATA FETCHING FUNCTIONS
// ============================================================================

/**
 * Fetch price data for all tickers concurrently with batch processing
 */
async function fetchAllPriceData(tickers, apiKey) {
  // Process in batches to avoid rate limiting
  const batchSize = 4; // Safe batch size for Twelve Data free plan
  const allData = [];
  
  for (let i = 0; i < tickers.length; i += batchSize) {
    const batch = tickers.slice(i, i + batchSize);
    const batchPromises = batch.map(ticker => 
      fetchPriceData(ticker, apiKey)
        .then(priceData => ({ ticker, data: priceData }))
    );
    
    const batchResults = await Promise.all(batchPromises);
    allData.push(...batchResults);
    
    // Small delay between batches to avoid rate limiting
    if (i + batchSize < tickers.length) {
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  }
  
  return allData;
}

// Twelve Data daily price history.
async function fetchPriceData(ticker, apiKey) {
  // Use a larger outputsize to get more historical data for better optimization
  const url = `https://api.twelvedata.com/time_series?symbol=${ticker}&interval=1day&outputsize=200&apikey=${apiKey}`;
  const response = await fetch(url);

  const body = await response.text();
  let raw;
  try {
    raw = JSON.parse(body);
  } catch {
    throw new Error(body.trim() || 'Price fetch failed');
  }

  if (raw && raw.status === 'error') throw new Error(raw.message || 'Price fetch failed');
  if (!response.ok) throw new Error('Price fetch failed');

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

// ============================================================================
// DATA PROCESSING FUNCTIONS
// ============================================================================

/**
 * Align all tickers to a common date range (intersection of all available dates)
 */
function alignPriceData(allTickersData) {
  if (allTickersData.length === 0) return [];
  
  // Find common dates across all tickers
  const allDates = allTickersData.map(data => 
    data.data.map(d => d.date)
  );
  
  const commonDates = findCommonDates(allDates);
  
  if (commonDates.length < 10) {
    // If not enough common dates, find dates that have most tickers
    const allFlatDates = allTickersData.flatMap(data => data.data.map(d => d.date));
    const dateCounts = {};
    allFlatDates.forEach(date => {
      dateCounts[date] = (dateCounts[date] || 0) + 1;
    });
    // Use dates that have at least 50% of tickers
    const threshold = Math.ceil(allTickersData.length / 2);
    commonDates.push(...Object.keys(dateCounts)
      .filter(date => dateCounts[date] >= threshold)
      .sort((a, b) => a < b ? -1 : 1));
  }
  
  // Extract aligned data for each ticker
  const aligned = allTickersData.map(tickerData => {
    const alignedPrices = commonDates
      .map(date => {
        const priceObj = tickerData.data.find(d => d.date === date);
        return priceObj ? { date, close: priceObj.close } : null;
      })
      .filter(obj => obj !== null);
    
    return {
      ticker: tickerData.ticker,
      dates: alignedPrices.map(p => p.date),
      closes: alignedPrices.map(p => p.close)
    };
  });
  
  return aligned;
}

/**
 * Find dates common to all date arrays
 */
function findCommonDates(dateArrays) {
  if (dateArrays.length === 0) return [];
  if (dateArrays.length === 1) return [...dateArrays[0]];
  
  const common = new Set(dateArrays[0]);
  for (let i = 1; i < dateArrays.length; i++) {
    const currentSet = new Set(dateArrays[i]);
    for (const date of [...common]) {
      if (!currentSet.has(date)) {
        common.delete(date);
      }
    }
    if (common.size === 0) break;
  }
  
  return [...common].sort((a, b) => a < b ? -1 : 1);
}

/**
 * Calculate daily returns from price data
 */
function calculateDailyReturns(alignedData) {
  return alignedData.map(tickerData => {
    const closes = tickerData.closes;
    const dailyReturns = [];
    
    for (let i = 1; i < closes.length; i++) {
      const dailyReturn = (closes[i] - closes[i - 1]) / closes[i - 1];
      dailyReturns.push(dailyReturn);
    }
    
    return {
      ticker: tickerData.ticker,
      dates: tickerData.dates.slice(1), // Remove first date since we start from i=1
      returns: dailyReturns
    };
  });
}

// ============================================================================
// PORTFOLIO STATISTICS FUNCTIONS
// ============================================================================

/**
 * Calculate mean returns and covariance matrix from returns data
 */
function calculatePortfolioStatistics(returnsData) {
  const nAssets = returnsData.length;
  const nObservations = returnsData[0].returns.length;
  
  // Calculate mean returns for each asset
  const meanReturns = returnsData.map(asset => {
    const sum = asset.returns.reduce((acc, r) => acc + r, 0);
    return sum / nObservations;
  });
  
  // Calculate covariance matrix
  const covMatrix = [];
  for (let i = 0; i < nAssets; i++) {
    const row = [];
    for (let j = 0; j < nAssets; j++) {
      if (i === j) {
        // Variance
        const returnsI = returnsData[i].returns;
        const meanI = meanReturns[i];
        const variance = returnsI.reduce((acc, r) => acc + Math.pow(r - meanI, 2), 0) / (nObservations - 1);
        row.push(variance);
      } else {
        // Covariance
        const returnsI = returnsData[i].returns;
        const returnsJ = returnsData[j].returns;
        const meanI = meanReturns[i];
        const meanJ = meanReturns[j];
        
        let covariance = 0;
        for (let k = 0; k < nObservations; k++) {
          covariance += (returnsI[k] - meanI) * (returnsJ[k] - meanJ);
        }
        row.push(covariance / (nObservations - 1));
      }
    }
    covMatrix.push(row);
  }
  
  return { meanReturns, covMatrix };
}

/**
 * Calculate portfolio performance metrics given weights
 */
function calculatePortfolioPerformance(weights, meanReturns, covMatrix) {
  // Portfolio return: weighted sum of individual returns
  let portfolioReturn = 0;
  for (let i = 0; i < weights.length; i++) {
    portfolioReturn += weights[i] * meanReturns[i];
  }
  
  // Portfolio variance: w^T * Cov * w
  let portfolioVariance = 0;
  for (let i = 0; i < weights.length; i++) {
    for (let j = 0; j < weights.length; j++) {
      portfolioVariance += weights[i] * covMatrix[i][j] * weights[j];
    }
  }
  
  const portfolioVolatility = Math.sqrt(portfolioVariance);
  
  return {
    portfolioReturn,
    portfolioVolatility,
    portfolioVariance
  };
}

/**
 * Calculate Sharpe ratio
 */
function calculateSharpeRatio(portfolioReturn, portfolioVolatility, riskFreeRate = 0) {
  const excessReturn = portfolioReturn - riskFreeRate;
  
  // Avoid division by zero
  if (portfolioVolatility === 0) {
    return excessReturn > 0 ? Infinity : 0;
  }
  
  return excessReturn / portfolioVolatility;
}

// ============================================================================
// MATRIX OPERATIONS
// ============================================================================

/**
 * Matrix multiplication
 */
function matrixDot(a, b) {
  const rowsA = a.length;
  const colsA = a[0].length;
  const colsB = b[0].length;
  
  const result = [];
  
  for (let i = 0; i < rowsA; i++) {
    const row = [];
    for (let j = 0; j < colsB; j++) {
      let sum = 0;
      for (let k = 0; k < colsA; k++) {
        sum += a[i][k] * b[k][j];
      }
      row.push(sum);
    }
    result.push(row);
  }
  
  return result;
}

/**
 * Vector dot product
 */
function vectorDot(a, b) {
  let sum = 0;
  for (let i = 0; i < a.length; i++) {
    sum += a[i] * b[i];
  }
  return sum;
}

// ============================================================================
// PORTFOLIO OPTIMIZATION FUNCTIONS
// ============================================================================

/**
 * Optimize portfolio to maximize Sharpe ratio using numerical optimization
 * For small portfolios (<=4 assets), uses brute-force grid search
 * For larger portfolios, uses iterative random search
 */
function optimizePortfolioSharpe(meanReturns, covMatrix, riskFreeRate = 0, tickers = []) {
  const nAssets = meanReturns.length;
  
  // For small portfolios, use brute-force grid search for accuracy
  if (nAssets <= 4) {
    return optimizePortfolioSharpeGridSearch(meanReturns, covMatrix, riskFreeRate, tickers);
  } else {
    // For larger portfolios, use random search optimization
    return optimizePortfolioSharpeRandom(meanReturns, covMatrix, riskFreeRate, tickers);
  }
}

/**
 * Brute-force grid search optimization for small portfolios
 */
function optimizePortfolioSharpeGridSearch(meanReturns, covMatrix, riskFreeRate = 0, tickers = []) {
  const nAssets = meanReturns.length;
  const steps = GRID_SEARCH_STEPS;
  
  let bestSharpe = -Infinity;
  let bestWeights = null;
  let bestMetrics = null;
  
  // For n assets, we use n-1 dimensions (last weight = 1 - sum of others)
  if (nAssets === 1) {
    // Special case: single asset
    return {
      weights: [1],
      tickers,
      annualReturn: annualizeReturn(meanReturns[0]),
      annualVolatility: annualizeVolatility(Math.sqrt(covMatrix[0][0])),
      sharpeRatio: calculateSharpeRatio(
        annualizeReturn(meanReturns[0]), 
        annualizeVolatility(Math.sqrt(covMatrix[0][0])), 
        annualizeReturn(riskFreeRate)
      ),
      dailyReturn: meanReturns[0],
      dailyVolatility: Math.sqrt(covMatrix[0][0])
    };
  }

  // Generate grid points
  for (let i = 0; i <= steps; i++) {
    for (let j = 0; j <= steps; j++) {
      // For 2D case, use two weights
      if (nAssets === 2) {
        const w1 = i / steps;
        const w2 = 1 - w1;
        
        if (w2 < 0) continue;
        
        const weights = [w1, w2];
        
        // Calculate portfolio performance
        const result = evaluateWeights(weights, meanReturns, covMatrix, riskFreeRate);
        
        if (result.sharpe > bestSharpe) {
          bestSharpe = result.sharpe;
          bestWeights = [...weights];
          bestMetrics = result;
        }
      } else if (nAssets === 3) {
        const w1 = i / steps;
        const w2 = j / steps;
        
        if (w1 + w2 > 1) continue;
        const w3 = 1 - w1 - w2;
        
        if (w3 < 0) continue;
        
        const weights = [w1, w2, w3];
        
        // Calculate portfolio performance
        const result = evaluateWeights(weights, meanReturns, covMatrix, riskFreeRate);
        
        if (result.sharpe > bestSharpe) {
          bestSharpe = result.sharpe;
          bestWeights = [...weights];
          bestMetrics = result;
        }
      } else if (nAssets === 4) {
        const w1 = i / steps;
        const w2 = j / steps;
        
        if (w1 + w2 > 0.9) continue;
        
        for (let k = 0; k <= steps; k++) {
          const w3 = k / steps * (0.9 - w1 - w2);
          const w4 = 1 - w1 - w2 - w3;
          
          if (w4 < 0 || w3 < 0) continue;
          
          const weights = [w1, w2, w3, w4];
          
          // Calculate portfolio performance
          const result = evaluateWeights(weights, meanReturns, covMatrix, riskFreeRate);
          
          if (result.sharpe > bestSharpe) {
            bestSharpe = result.sharpe;
            bestWeights = [...weights];
            bestMetrics = result;
          }
        }
      }
    }
  }
  
  // Add random sampling for better coverage
  if (bestWeights) {
    const refined = refineSolution(bestWeights, meanReturns, covMatrix, riskFreeRate);
    if (refined.sharpeRatio > bestSharpe) {
      return refined;
    }
  }
  
  return {
    weights: bestWeights,
    tickers,
    annualReturn: bestMetrics.annualReturn,
    annualVolatility: bestMetrics.annualVolatility,
    sharpeRatio: bestMetrics.sharpe,
    dailyReturn: bestMetrics.dailyReturn,
    dailyVolatility: bestMetrics.dailyVolatility
  };
}

/**
 * Random search optimization for larger portfolios
 */
function optimizePortfolioSharpeRandom(meanReturns, covMatrix, riskFreeRate = 0, tickers = []) {
  const nAssets = meanReturns.length;
  const nSamples = 50000;
  
  let bestSharpe = -Infinity;
  let bestWeights = null;
  let bestMetrics = null;
  
  // Start with equal weights
  bestWeights = Array(nAssets).fill(1 / nAssets);
  bestMetrics = evaluateWeights(bestWeights, meanReturns, covMatrix, riskFreeRate);
  bestSharpe = bestMetrics.sharpe;
  
  // Generate random weight combinations
  for (let i = 0; i < nSamples; i++) {
    // Generate random weights
    const randomWeights = generateRandomWeights(nAssets);
    
    // Allow small negative weights temporarily, then clamp
    const perturbedWeights = perturbWeights(bestWeights, nAssets, 0.1);
    
    const result = evaluateWeights(perturbedWeights, meanReturns, covMatrix, riskFreeRate);
    
    if (result.sharpe > bestSharpe) {
      bestSharpe = result.sharpe;
      bestWeights = [...perturbedWeights];
      bestMetrics = result;
    }
  }
  
  // Refine with local search
  const refined = refineSolution(bestWeights, meanReturns, covMatrix, riskFreeRate);
  if (refined.sharpeRatio > bestSharpe) {
    return refined;
  }
  
  return {
    weights: bestWeights,
    tickers,
    annualReturn: bestMetrics.annualReturn,
    annualVolatility: bestMetrics.annualVolatility,
    sharpeRatio: bestMetrics.sharpe,
    dailyReturn: bestMetrics.dailyReturn,
    dailyVolatility: bestMetrics.dailyVolatility
  };
}

/**
 * Evaluate weights and return metrics
 */
function evaluateWeights(weights, meanReturns, covMatrix, riskFreeRate) {
  // Clamp and renormalize weights
  const clamped = clampAndNormalizeWeights([...weights]);
  
  const { portfolioReturn, portfolioVolatility } = calculatePortfolioPerformance(
    clamped, meanReturns, covMatrix
  );
  
  const annualReturn = annualizeReturn(portfolioReturn);
  const annualVolatility = annualizeVolatility(portfolioVolatility);
  const annualRiskFreeRate = annualizeReturn(riskFreeRate);
  const sharpe = calculateSharpeRatio(annualReturn, annualVolatility, annualRiskFreeRate);
  
  return {
    weights: clamped,
    annualReturn,
    annualVolatility,
    sharpe,
    dailyReturn: portfolioReturn,
    dailyVolatility: portfolioVolatility
  };
}

/**
 * Annualize daily return
 */
function annualizeReturn(dailyReturn) {
  return Math.pow(1 + dailyReturn, TRADING_DAYS_PER_YEAR) - 1;
}

/**
 * Annualize daily volatility
 */
function annualizeVolatility(dailyVolatility) {
  return dailyVolatility * Math.sqrt(TRADING_DAYS_PER_YEAR);
}

/**
 * Clamp negative weights to zero and renormalize
 */
function clampAndNormalizeWeights(weights) {
  // Clamp negative weights to zero
  const clamped = weights.map(w => Math.max(0, w));
  
  // Normalize to sum to 1
  const sum = clamped.reduce((a, b) => a + b, 0);
  
  if (sum > 0) {
    return clamped.map(w => w / sum);
  } else {
    // If all weights are zero, distribute evenly
    const n = clamped.length;
    return clamped.map(() => 1 / n);
  }
}

/**
 * Generate random weights that sum to 1
 */
function generateRandomWeights(n) {
  const weights = Array(n).fill(0).map(() => Math.random());
  const sum = weights.reduce((a, b) => a + b, 0);
  return weights.map(w => w / sum);
}

/**
 * Perturb existing weights by adding random noise
 */
function perturbWeights(weights, n, scale) {
  const perturbed = weights.map((w, i) => {
    const noise = (Math.random() - 0.5) * scale * 2;
    return Math.max(0, w + noise);
  });
  
  // Renormalize
  const sum = perturbed.reduce((a, b) => a + b, 0);
  return perturbed.map(w => w / sum);
}

/**
 * Refine solution with local search
 */
function refineSolution(initialWeights, meanReturns, covMatrix, riskFreeRate) {
  const nAssets = meanReturns.length;
  const epsilon = 0.05; // 5% perturbation
  const nSamples = 5000;
  
  let bestWeights = [...initialWeights];
  let bestSharpe = evaluateWeights(bestWeights, meanReturns, covMatrix, riskFreeRate).sharpe;
  
  for (let i = 0; i < nSamples; i++) {
    const weights = perturbWeights(bestWeights, nAssets, epsilon);
    const sharpe = evaluateWeights(weights, meanReturns, covMatrix, riskFreeRate).sharpe;
    
    if (sharpe > bestSharpe) {
      bestSharpe = sharpe;
      bestWeights = [...weights];
    }
  }
  
  // Calculate final metrics
  const result = evaluateWeights(bestWeights, meanReturns, covMatrix, riskFreeRate);
  
  return {
    weights: result.weights,
    tickers: [],
    annualReturn: result.annualReturn,
    annualVolatility: result.annualVolatility,
    sharpeRatio: result.sharpe,
    dailyReturn: result.dailyReturn,
    dailyVolatility: result.dailyVolatility
  };
}

// ============================================================================
// AI RESEARCH NOTE (Optional)
// ============================================================================

// OpenRouter call for generating AI research notes
async function getResearchNote(ticker, priceData, apiKey) {
  const first = priceData[0];
  const latest = priceData[priceData.length - 1];
  const pctChange = ((latest.close - first.close) / first.close) * 100;

  const summary =
    `${ticker} daily closes from ${first.date} to ${latest.date}: ` +
    `start $${first.close.toFixed(2)}, latest $${latest.close.toFixed(2)}, ` +
    `change ${pctChange.toFixed(1)}% over ${priceData.length} trading days.`;

  const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: 'anthropic/claude-sonnet-5',
      max_tokens: 1500,
      reasoning: { enabled: false },
      messages: [
        { role: 'system', content: 'You are a financial research assistant. Be concise and factual.' },
        { role: 'user', content: `${summary}\n\nWrite a one paragraph research note for ${ticker} based on this recent price action.` }
      ]
    })
  });

  if (!response.ok) throw new Error(`OpenRouter call failed. ${await readOpenRouterError(response)}`);
  const data = await response.json();
  return data.choices?.[0]?.message?.content ?? 'No response.';
}

// Pulls the useful part out of an OpenRouter error response
async function readOpenRouterError(response) {
  let message = '';
  try {
    const body = await response.json();
    const err = body.error ?? body;
    message = err.message || '';
    const provider = err.metadata?.provider_name;
    const raw = err.metadata?.raw;
    if (provider) message += ` [provider: ${provider}]`;
    if (raw) message += ` ${typeof raw === 'string' ? raw : JSON.stringify(raw)}`;
  } catch {
    // Response body was not JSON
  }
  const hint = {
    401: 'Your API key looks invalid or missing',
    402: 'This model is paid and your OpenRouter account is out of credits',
    429: 'Rate limited, wait a moment and try again'
  }[response.status];
  return [`(HTTP ${response.status})`, hint, message].filter(Boolean).join(' ');
}

// ============================================================================
// RESULTS RENDERING
// ============================================================================

function renderResults(tickers, allPriceData, alignedData, returnsData, optimization, notes, riskFreeRate) {
  const {
    weights,
    annualReturn,
    annualVolatility,
    sharpeRatio,
    dailyReturn,
    dailyVolatility
  } = optimization;
  
  // Sort results by weight (descending)
  const sortedResults = tickers.map((ticker, index) => ({
    ticker,
    weight: weights[index] || 0,
    note: notes[ticker] || ''
  })).sort((a, b) => b.weight - a.weight);
  
  // Calculate the sum of weights (should be ~1)
  const totalWeight = sortedResults.reduce((sum, item) => sum + item.weight, 0);
  
  // Build HTML
  let html = `
    <div class="portfolio-results">
      <h2>Portfolio Optimization Results</h2>
      
      <div class="portfolio-summary">
        <h3>Portfolio Summary</h3>
        <div class="summary-grid">
          <div class="summary-item">
            <span class="summary-label">Number of Assets:</span>
            <span class="summary-value">${tickers.length}</span>
          </div>
          <div class="summary-item">
            <span class="summary-label">Expected Annual Return:</span>
            <span class="summary-value">${formatPercent(annualReturn)}</span>
          </div>
          <div class="summary-item">
            <span class="summary-label">Annual Volatility:</span>
            <span class="summary-value">${formatPercent(annualVolatility)}</span>
          </div>
          <div class="summary-item">
            <span class="summary-label">Sharpe Ratio:</span>
            <span class="summary-value">${sharpeRatio.toFixed(4)}</span>
          </div>
          <div class="summary-item">
            <span class="summary-label">Risk-Free Rate:</span>
            <span class="summary-value">${riskFreeRate.toFixed(1)}%</span>
          </div>
          <div class="summary-item">
            <span class="summary-label">Total Weight:</span>
            <span class="summary-value">${formatPercent(totalWeight)}</span>
          </div>
        </div>
      </div>
      
      <div class="portfolio-allocation">
        <h3>Optimal Allocation</h3>
        <div class="allocation-chart">
  `;
  
  // Generate allocation bars
  for (const item of sortedResults) {
    const barWidth = (item.weight * 100).toFixed(1);
    html += `
          <div class="allocation-item">
            <div class="allocation-bar" style="width: ${barWidth}%">
              <span class="allocation-ticker">${item.ticker}</span>
              <span class="allocation-percent">${formatPercent(item.weight)}</span>
            </div>
          </div>
    `;
  }
  
  html += `
        </div>
        <table class="allocation-table">
          <thead>
            <tr>
              <th>Ticker</th>
              <th>Weight</th>
              <th>Allocation</th>
            </tr>
          </thead>
          <tbody>
  `;
  
  for (const item of sortedResults) {
    html += `
            <tr>
              <td><strong>${item.ticker}</strong></td>
              <td>${formatPercent(item.weight)}</td>
              <td>
                <div class="table-bar" style="width: ${(item.weight * 100).toFixed(1)}%"></div>
              </td>
            </tr>
    `;
  }
  
  html += `
          </tbody>
        </table>
      </div>
  `;
  
  // Add AI research notes if available
  if (Object.keys(notes).length > 0) {
    html += `
      <div class="research-notes">
        <h3>AI Research Notes</h3>
    `;
    
    for (const item of sortedResults) {
      if (item.note && item.note !== 'No response.') {
        html += `
        <div class="note-item">
          <h4>${item.ticker}</h4>
          <p>${item.note}</p>
        </div>
        `;
      }
    }
    
    html += `
      </div>
    `;
  }
  
  // Add data statistics
  html += `
      <div class="data-statistics">
        <h3>Data Statistics</h3>
        <p><strong>Data Period:</strong> ${getDataDateRange(allPriceData)}</p>
        <p><strong>Common Observations:</strong> ${alignedData.length > 0 ? alignedData[0].closes.length : 0} data points</p>
        <p><strong>Calculation Method:</strong> ${tickers.length <= 4 ? 'Grid Search Optimization' : 'Random Search Optimization'}</p>
      </div>
  `;
  
  html += `
    </div>
  `;
  
  results.innerHTML = html;
}

/**
 * Get the date range from all price data
 */
function getDataDateRange(allPriceData) {
  if (allPriceData.length === 0) return 'N/A';
  
  const allDates = allPriceData.flatMap(data => data.data.map(d => d.date));
  const sortedDates = [...new Set(allDates)].sort((a, b) => a < b ? -1 : 1);
  
  if (sortedDates.length >= 2) {
    return `${sortedDates[0]} to ${sortedDates[sortedDates.length - 1]}`;
  } else if (sortedDates.length === 1) {
    return sortedDates[0];
  }
  return 'N/A';
}

/**
 * Format number as percentage
 */
function formatPercent(value) {
  if (value === undefined || value === null || isNaN(value)) return 'N/A';
  const sign = value >= 0 ? '' : '-';
  const absValue = Math.abs(value) * 100;
  return `${sign}${absValue.toFixed(2)}%`;
}

/**
 * Format currency value
 */
function formatCurrency(value) {
  return value !== undefined && value !== null && !isNaN(value) 
    ? `$${value.toFixed(2)}` 
    : 'N/A';
}
