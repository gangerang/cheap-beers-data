# Beer Data Transformation Project

This repository contains code to transform raw beer data into a cleaned and enriched dataset. The raw data is provided in JSON format and is processed to extract, merge, and calculate various properties and pricing details for each beer product.

## Project Overview

The project is designed to extract price and product details on alcohol items in both a raw and refined format. The raw data from beer is then transformed into a cleaned dataset that includes key product details, pricing information, and derived properties. The transformation script processes the raw data to extract core details, compute derived properties, restructure pricing information, and calculate alcohol tax values. The transformation includes:

- **Extracting core details:**  
  The raw data includes multiple fields per product. Our script extracts key details such as name, brand, size, alcohol percentage, standard drinks, and product images.

- **Computing derived properties:**  
  Additional properties such as a "clean" name, vessel type (bottle, can, or longneck), and size (in milliliters) are computed.  
  The script also calculates a standardized measure of standard drinks using the formula:  
  \[
  \text{standard\_drinks\_clean} = \frac{\text{percentage\_raw} \times \text{size\_clean}}{1267}
  \]
  with fallbacks to the raw values when appropriate.

- **Restructuring pricing information:**  
  The pricing data is split into different groups (case, pack, single, and their special promotional variants). For each group, unit prices, cost per standard drink, and alcohol tax costs are calculated.

- **Alcohol Tax Calculation:**  
  Global alcohol tax values are computed based on the product's volume, alcohol percentage, and applicable tax rates.
  Standard drinks = alcohol % * volume in ml / 12.67
  See [Alcohol Tax Rates](https://www.ato.gov.au/Business/Excise-and-excise-equivalent-goods/Excise-rates-for-alcohol/) for more information.

## Key Datasets

### Current

- **`datasets_raw/beer_raw.json`:**  
  Produced by `scripts/api.js` and contains the raw beer data in JSON format. This file is used by `scripts/transform_beer_raw.js` to produce `datasets_cleaned/beer.json`.

- **`datasets_cleaned/beer.json`:**  
  The final output file from the raw data. It includes enriched properties and structured pricing data for each beer product. Used as source for website.

### Superseded
  
- **`datasets_raw/beer.json`:**  
  Produced by `scripts/api.js` and contains semi-refined beer in JSON format. This file is used by `scripts/transform.js` to produce `datasets_cleaned/beer_cleaned.json`.

- **`datasets_cleaned/beer_cleaned.json`:**  
  Previous cleaned file in JSON format. No longer used in website.



## Running

Github actions are currenly used to run the data collection and then transformation scripts. `scripts/api.js` is run daily to collect the latest beer data from the API. The transformation script `scripts/transform_beer_raw.js` is then run to process the raw data into a cleaned dataset. The cleaned dataset is then used to update the website. Each file is commited to the repo when generated.

## License

See the [LICENSE](LICENSE) file for details.