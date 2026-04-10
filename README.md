# Interactive Visualization Assignment

An interactive data visualization project hosted on **GitHub Pages**.

🔗 **Live site:** https://shengtang24.github.io/Interactive-Visualization-Assignment/

## Charts included

| Chart | Description |
|-------|-------------|
| Bar Chart | Monthly sales by product category with animated bars |
| Line Chart | Annual average temperature trends (2015–2024) for three cities |
| Scatter Plot | GDP per capita vs. life expectancy with population-scaled bubbles |
| Pie Chart | Global energy source distribution (donut chart) |

All charts are fully interactive — hover for tooltips, click to highlight, and use the controls to filter or adjust the view.

## Technology

- [D3.js v7](https://d3js.org/) — data-driven visualizations
- Plain HTML / CSS / JavaScript (no build step required)
- Deployed automatically via GitHub Actions on every push to `main`

## Deployment

GitHub Pages is configured to deploy from the repository root using the workflow in
`.github/workflows/deploy-pages.yml`. Enable **GitHub Pages** in the repository settings
(Settings → Pages → Source → GitHub Actions) to activate automatic deployment.