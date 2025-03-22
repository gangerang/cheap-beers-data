const fs = require('fs/promises');
const path = require('path');

async function processBeerData() {
  try {
    // Adjusted path: assume the script is in "scripts" folder
    const rawPath = path.join(__dirname, '..', 'datasets_raw', 'beer_raw.json');
    const rawContent = await fs.readFile(rawPath, 'utf8');
    const beers = JSON.parse(rawContent);

    const output = [];

    for (const record of beers) {
      if (!record.Products || record.Products.length === 0) continue;
      
      // Use the first product (JavaScript arrays are 0-indexed)
      const product = record.Products[0];
      if (!product.Stockcode) continue;
      const prices = product.Prices || {};

      // Extract price_data using lowercase keys (as in your JSON)
      const priceData = {
        stockcode: product.Stockcode,
        case_type: prices.caseprice?.Message,
        case_price: prices.caseprice?.Value,
        case_promo: prices.caseprice?.AfterPromotion,
        case_ismember: prices.caseprice?.IsMemberOffer,
        pack_type: prices.singleprice?.Message,
        pack_price: prices.singleprice?.Value,
        pack_promo: prices.singleprice?.AfterPromotion,
        single_type: prices.inanysixprice?.Message,
        single_price: prices.inanysixprice?.Value,
        single_promo: prices.inanysixprice?.AfterPromotion,
        promo_type: prices.promoprice?.Message,
        promo_price_regular: prices.promoprice?.BeforePromotion,
        promo_price: prices.promoprice?.AfterPromotion,
        promo_ismember: prices.promoprice?.IsMemberOffer
      };

      // Initialize detailData with null defaults
      const detailData = {
        name: null,
        short_name: null,
        brand: null,
        size: null,
        percent: null,
        standard_drinks: null,
        image_url: null,
        rating: null,
        ibu: null,
        beer_style: null,
        pack_size: null,
        case_size: null
      };

      // Process AdditionalDetails for each product
      if (Array.isArray(record.Products)) {
        for (const prod of record.Products) {
          if (Array.isArray(prod.AdditionalDetails)) {
            for (const detail of prod.AdditionalDetails) {
              // Check that Name and Value exist
              if (detail.Name && detail.Value !== undefined && detail.Value !== null) {
                // Convert the value to string and remove double quotes
                const cleanValue = String(detail.Value).replace(/"/g, '');
                switch (detail.Name) {
                  case 'producttitle':
                    detailData.name = cleanValue;
                    break;
                  case 'product_short_name':
                    detailData.short_name = cleanValue;
                    break;
                  case 'webbrandname':
                    detailData.brand = cleanValue;
                    break;
                  case 'webliquorsize':
                    detailData.size = cleanValue;
                    break;
                  case 'webalcoholpercentage':
                    detailData.percent = cleanValue;
                    break;
                  case 'standarddrinks':
                    detailData.standard_drinks = cleanValue;
                    break;
                  case 'image1':
                    detailData.image_url = cleanValue;
                    break;
                  case 'webaverageproductrating':
                    detailData.rating = cleanValue;
                    break;
                  case 'ibu':
                    detailData.ibu = cleanValue;
                    break;
                  case 'webbeerstyle':
                    detailData.beer_style = cleanValue;
                    break;
                  case 'webpacksizeinner':
                    detailData.pack_size = cleanValue;
                    break;
                  case 'webpacksizecase':
                    detailData.case_size = cleanValue;
                    break;
                  default:
                    break;
                }
              }
            }
          }
        }
      }

      // Combine price and detail data
      const combined = { ...priceData, ...detailData };

      // Apply filtering:
      // - Exclude records with stockcode starting with "ER"
      // - Exclude records where percent is missing or equal to "0%"
      if (
        combined.stockcode &&
        !combined.stockcode.startsWith('ER') &&
        combined.percent &&
        combined.percent !== '0%'
      ) {
        output.push(combined);
      }
    }

    // Write the detailed JSON to the output file
    const outPath = path.join(__dirname, '..', 'datasets_cleaned', 'beer_detailed.json');
    await fs.writeFile(outPath, JSON.stringify(output, null, 2), 'utf8');
    console.log('Output written to', outPath);
  } catch (err) {
    console.error('Error processing beer data:', err);
  }
}

processBeerData();
