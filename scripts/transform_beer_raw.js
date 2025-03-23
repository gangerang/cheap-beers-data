const fs = require('fs/promises');
const path = require('path');

// Update the init function to create a more flexible corrections map
async function init() {
  try {
    // Read corrections file
    const corrections = JSON.parse(
      await fs.readFile('datasets_corrections/beer.json', 'utf8')
    );

    // Create a map of corrections by stockcode with all their correction fields
    const correctionsMap = new Map(
      corrections.map(item => [
        item.stockcode,
        Object.fromEntries(
          Object.entries(item).filter(([key]) => key !== 'stockcode')
        )
      ])
    );

    return correctionsMap;
  } catch (err) {
    console.error("Error reading corrections file:", err);
    process.exit(1);
  }
}

// Helper function to round to a given number of decimals.
function roundTo(value, decimals) {
  return Math.round(value * Math.pow(10, decimals)) / Math.pow(10, decimals);
}

// Safely convert a value to a number. Logs error if conversion fails.
function safeConvertNumber(value, fieldName, stockcode) {
  const num = Number(value);
  if (isNaN(num)) {
    console.error(`Conversion error for stockcode ${stockcode}: field ${fieldName} with value ${value}`);
    return null;
  }
  return num;
}

// Extract the first numeric value from a string.
function extractNumberFromString(str, fieldName, stockcode) {
  const match = str.match(/[\d.]+/);
  if (!match) {
    console.error(`Extraction error for stockcode ${stockcode}: field ${fieldName} with value "${str}"`);
    return null;
  }
  const num = parseFloat(match[0]);
  if (isNaN(num)) {
    console.error(`Extraction error (NaN) for stockcode ${stockcode}: field ${fieldName} with value "${str}"`);
    return null;
  }
  return num;
}

async function processBeer() {
  // Get the corrections map first
  const correctionsMap = await init();
  
  try {
    // Step 1: Read raw beer data from datasets_raw/beer_raw.json.
    const rawPath = path.join(__dirname, '..', 'datasets_raw', 'beer_raw.json');
    const rawContent = await fs.readFile(rawPath, 'utf8');
    const rawBeers = JSON.parse(rawContent);
    const combinedRecords = [];

    // For each raw record, extract pricing and detail fields.
    for (const record of rawBeers) {
      if (!record.Products || record.Products.length === 0) continue;
      
      // Use the first product (0-indexed)
      const product = record.Products[0];
      if (!product.Stockcode) continue;
      const prices = product.Prices || {};

      // Extract price data (using lowercase keys as in JSON)
      const priceData = {
        stockcode: product.Stockcode,
        case_type: prices.caseprice?.Message,
        case_price: prices.caseprice?.Value,
        case_promo: prices.caseprice?.AfterPromotion,
        pack_type: prices.singleprice?.Message,
        pack_price: prices.singleprice?.Value,
        pack_promo: prices.singleprice?.AfterPromotion,
        single_type: prices.inanysixprice?.Message,
        single_price: prices.inanysixprice?.Value,
        single_promo: prices.inanysixprice?.AfterPromotion,
        promo_type: prices.promoprice?.Message,
        promo_price_regular: prices.promoprice?.BeforePromotion,
        promo_price: prices.promoprice?.AfterPromotion
      };

      // Initialize detail fields with defaults.
      const detailData = {
        name: null,
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

      // Loop through AdditionalDetails to extract desired fields.
      for (const prod of record.Products) {
        if (Array.isArray(prod.AdditionalDetails)) {
          for (const detail of prod.AdditionalDetails) {
            if (detail.Name && detail.Value != null) {
              const cleanValue = String(detail.Value).replace(/"/g, '');
              switch (detail.Name) {
                case 'producttitle':
                  detailData.name = cleanValue;
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
      // Merge price and detail data.
      const combined = { ...priceData, ...detailData };
      
      // Filter: Exclude if stockcode starts with "ER" or percent is missing/zero.
      if (
        combined.stockcode &&
        !combined.stockcode.startsWith('ER') &&
        combined.percent &&
        combined.percent !== '0%'
      ) {
        combinedRecords.push(combined);
      }
    }

    // Step 2: Transform combined records to final output.
    const output = [];
    // Regex to remove trailing size info from name.
    const nameCleanPattern = /(\s*((?:(?:bottles?|cans?|longnecks?)\s*)?\d+(?:\s*[Xx]\s*\d+)*(?:\s*mL)(?:\s*(?:bottles?|cans?|longnecks?))?(?:\s*\(.*\))?))$/i;

    for (const rec of combinedRecords) {
      const stockcode = rec.stockcode;
      const corrections = correctionsMap.get(stockcode) || {};

      // PROPERTIES:
      const name = rec.name || "";
      const name_clean = corrections.name_clean || name.replace(nameCleanPattern, '').trim();
      const brand = rec.brand || null;
      
      // size_ml: extract number from rec.size; if less than 5, assume liters.
      let size_ml = null;
      if (rec.size) {
        const extracted = extractNumberFromString(rec.size, "size", stockcode);
        if (extracted !== null) {
          size_ml = extracted;
          if (size_ml < 5) {
            size_ml = size_ml * 1000;
          }
        }
      }
      
      // raw_percent: take first 4 characters of rec.percent (remove '%') and convert.
      let raw_percent = null;
      if (rec.percent) {
        const percentStr = rec.percent.substring(0, 4).replace('%', '');
        raw_percent = safeConvertNumber(percentStr, "percent", stockcode);
      }
      
      // raw_standard_drinks: convert rec.standard_drinks to number.
      let raw_standard_drinks = null;
      if (rec.standard_drinks) {
        raw_standard_drinks = safeConvertNumber(rec.standard_drinks, "standard_drinks", stockcode);
      }
      if (raw_percent !== null && raw_percent < 0.1 && raw_standard_drinks && raw_standard_drinks !== 0) {
        raw_percent = raw_percent * 100;
      }
      
      const image_url = rec.image_url || null;
      let rating = null;
      if (rec.rating != null) {
        rating = safeConvertNumber(rec.rating, "rating", stockcode);
        if (rating !== null) {
          rating = Math.round(rating * 10) / 10;
        }
      }
      let ibu = null;
      if (rec.ibu) {
        ibu = safeConvertNumber(rec.ibu, "ibu", stockcode);
      }
      const beer_style = rec.beer_style || null;
      
      // vessel: determine from name if bottle, can, or longneck.
      let vessel = corrections.vessel || null;
      if (!vessel) {
        if (/bottles?/i.test(name)) {
          vessel = 'bottle';
        } else if (/cans?/i.test(name)) {
          vessel = 'can';
        } else if (/longnecks?/i.test(name)) {
          vessel = 'longneck';
        }
      }
      
      // size_clean: determine in three steps:
      // 1. Try extracting a 3-digit number from name.
      // 2. Else, if size_ml is between 100 and 999, use that.
      // 3. Else, calculate as (standard_drinks_raw * 1267) / raw_percent.
      let size_clean = null;
      const nameSizeMatches = name.match(/(?<!\d)\d{3}(?!\d)/g);
      if (nameSizeMatches && nameSizeMatches.length > 0) {
        size_clean = parseInt(nameSizeMatches[nameSizeMatches.length - 1], 10);
      } else if (size_ml !== null && size_ml >= 100 && size_ml < 1000) {
        size_clean = size_ml;
      } else if (raw_standard_drinks !== null && raw_percent !== null && raw_percent !== 0) {
        size_clean = roundTo((raw_standard_drinks * 1267) / raw_percent, 0);
      }
      
      // Rename raw fields.
      const percentage_raw = raw_percent;
      const standard_drinks_raw = raw_standard_drinks;
      
      // standard_drinks_clean: calculate as (percentage_raw * size_clean)/1267 rounded to 1dp.
      let standard_drinks_clean = null;
      if (size_clean !== null && percentage_raw !== null) {
        const calc = Number(((percentage_raw * size_clean) / 1267).toFixed(1));
        if (standard_drinks_raw !== null && Math.abs(calc - standard_drinks_raw) <= 0.15) {
          standard_drinks_clean = standard_drinks_raw;
        } else {
          standard_drinks_clean = calc;
        }
      }
      // If calculation failed, use raw value.
      if (standard_drinks_clean === null) {
        standard_drinks_clean = standard_drinks_raw;
      }
      
      const properties = {
        name,
        name_clean,
        brand,
        size_ml,
        size_clean,
        percentage_raw,
        standard_drinks_raw,
        standard_drinks_clean,
        vessel,
        image_url,
        rating,
        ibu,
        beer_style
      };
      
      // Global Alcohol Tax Calculation.
      const alcohol_fraction = properties.percentage_raw ? properties.percentage_raw / 100 : 0;
      const taxable_alcohol_fraction = Math.max(alcohol_fraction - 0.0115, 0);
      const taxable_volume = properties.size_clean ? (properties.size_clean / 1000) * taxable_alcohol_fraction : 0;
      const tax_rate = (alcohol_fraction <= 0.03) ? 52.66 : 61.32;
      const total_tax = taxable_volume * tax_rate;
      const global_alcohol_tax_cost = (properties.standard_drinks_clean && properties.standard_drinks_clean > 0)
        ? roundTo(total_tax / properties.standard_drinks_clean, 2)
        : 0;
      
      // PRICING TRANSFORMATIONS.
      let promo_type_clean = null;
      let promo_multiplier_clean = null;
      const promo_type = rec.promo_type;
      if (promo_type) {
        const promo_lower = promo_type.toLowerCase();
        if (promo_lower.includes("cases") || promo_lower.includes("packs") || promo_lower.includes("bottles")) {
          if (promo_lower.includes("cases")) {
            promo_type_clean = "case";
          } else if (promo_lower.includes("packs")) {
            promo_type_clean = "pack";
          } else if (promo_lower.includes("bottles")) {
            promo_type_clean = "single";
          }
          const numberMatch = promo_type.match(/\d+/);
          if (numberMatch) {
            promo_multiplier_clean = safeConvertNumber(numberMatch[0], "promo_multiplier", stockcode);
          } else {
            console.error(`No number found in promo_type for stockcode ${stockcode}: ${promo_type}`);
            promo_multiplier_clean = null;
          }
        } else if (promo_lower.includes("case") || promo_lower.includes("pack") || promo_lower.includes("bottle")) {
          if (promo_lower.includes("case")) {
            promo_type_clean = "case";
          } else if (promo_lower.includes("pack")) {
            promo_type_clean = "pack";
          } else if (promo_lower.includes("bottle")) {
            promo_type_clean = "single";
          }
          promo_multiplier_clean = 1;
        }
      }
      
      const case_price_clean = (rec.case_price !== undefined) ? rec.case_price : null;
      let case_promo_clean = (rec.case_promo === null || rec.case_promo === 0) ? null : rec.case_promo;
      
      let case_size_clean = null;
      if (rec.case_type && typeof rec.case_type === "string") {
        const numMatch = rec.case_type.match(/\d+/);
        if (numMatch) {
          case_size_clean = parseInt(numMatch[0], 10);
          if (isNaN(case_size_clean)) {
            console.error(`Conversion error for stockcode ${stockcode}: field case_size_clean from case_type with value "${rec.case_type}"`);
            case_size_clean = null;
          }
        }
      }
      if (case_size_clean === null && rec.case_size) {
        case_size_clean = safeConvertNumber(rec.case_size, "case_size", stockcode);
        if (case_size_clean === 0) {
          case_size_clean = null;
        }
      }
      
      let case_size_promo_clean = null;
      if (rec.promo_price === rec.case_promo && case_size_clean !== null && promo_multiplier_clean !== null) {
        case_size_promo_clean = case_size_clean * promo_multiplier_clean;
      } else {
        case_size_promo_clean = case_size_clean;
      }
      const case_exists = (case_size_clean !== null);
      
      // Pack and Single Pricing variables.
      let pack_price_clean = null;
      let pack_promo_clean = null;
      let pack_size_clean = null;
      let pack_size_promo_clean = null;
      let single_price_clean = null;
      let single_promo_clean = null;
      let single_exists = false;
      let single_promo_size_clean = null;
      const pack_type = rec.pack_type ? rec.pack_type.toLowerCase() : null;
      let packScenarioDetermined = false;
      
      if (pack_type && (pack_type.includes("each") || pack_type.includes("bottle"))) {
        // Special handling: if promo_type_clean is "single", then use pack fields for singles.
        if (promo_type_clean === 'single') {
          single_price_clean = rec.pack_price;
          single_promo_clean = rec.pack_promo;
          single_promo_size_clean = promo_multiplier_clean;
          pack_price_clean = null;
          pack_promo_clean = null;
          pack_size_clean = null;
          pack_size_promo_clean = null;
          packScenarioDetermined = true;
        } else {
          const packPrice = safeConvertNumber(rec.pack_price, "pack_price", stockcode);
          const packPromo = safeConvertNumber(rec.pack_promo, "pack_promo", stockcode);
          if (packPrice !== null && packPromo !== null && packPrice > packPromo) {
            if (rec.single_price && safeConvertNumber(rec.single_price, "single_price", stockcode) !== 0) {
              single_price_clean = rec.single_price;
              single_promo_clean = rec.single_promo;
            } else {
              single_price_clean = rec.pack_price;
              single_promo_clean = rec.pack_promo;
            }
            packScenarioDetermined = true;
          } else if (packPrice !== null && packPromo !== null && packPromo > packPrice && packPromo !== 0) {
            pack_promo_clean = rec.pack_promo;
            pack_size_clean = null;
            pack_price_clean = null;
          }
        }
      }
      if (!packScenarioDetermined) {
        pack_price_clean = rec.pack_price;
        pack_promo_clean = rec.pack_promo;
        if (pack_type) {
          const numMatch = pack_type.match(/\d+/);
          if (numMatch) {
            pack_size_clean = parseInt(numMatch[0], 10);
            if (isNaN(pack_size_clean)) {
              console.error(`Conversion error for stockcode ${stockcode}: field pack_size_clean from pack_type with value "${rec.pack_type}"`);
              pack_size_clean = null;
            }
          }
        }
        if (!pack_size_clean && rec.pack_size) {
          pack_size_clean = safeConvertNumber(rec.pack_size, "pack_size", stockcode);
          if (pack_size_clean === 0) {
            pack_size_clean = null;
          }
        }
      }
      
      if (pack_promo_clean !== null) {
        if (promo_type_clean === 'pack' && pack_size_clean !== null && promo_multiplier_clean !== null) {
          pack_size_promo_clean = pack_size_clean * promo_multiplier_clean;
        } else {
          pack_size_promo_clean = pack_size_clean;
        }
      }
      
      if (!packScenarioDetermined) {
        if (rec.single_price && safeConvertNumber(rec.single_price, "single_price", stockcode) !== 0) {
          single_price_clean = rec.single_price;
        } else {
          single_price_clean = null;
        }
      }
      if (single_price_clean !== null) {
        single_exists = true;
      }
      
      // NEW PRICING STRUCTURE: split into separate groups.
      function calcPricing(total_price, units, global_alcohol_tax_cost) {
        if (total_price === null) return null;
        let unit_price = null;
        let cost_per_standard = null;
        if (total_price !== null && units !== null && units !== 0) {
          unit_price = roundTo(total_price / units, 2);
          if (properties.standard_drinks_clean !== null && properties.standard_drinks_clean !== 0) {
            cost_per_standard = roundTo(unit_price / properties.standard_drinks_clean, 2);
          }
        }
        const alcohol_tax_percent = (cost_per_standard && cost_per_standard > 0)
          ? roundTo((global_alcohol_tax_cost / cost_per_standard) * 100, 0)
          : 0;
        return { total_price, units, unit_price, cost_per_standard, alcohol_tax_cost: global_alcohol_tax_cost, alcohol_tax_percent };
      }
      
      const pricingGroups = {
        case: calcPricing(case_price_clean, case_size_clean, global_alcohol_tax_cost),
        case_special: calcPricing(case_promo_clean, case_size_promo_clean, global_alcohol_tax_cost),
        pack: calcPricing(pack_price_clean, pack_size_clean, global_alcohol_tax_cost),
        pack_special: calcPricing(pack_promo_clean, pack_size_promo_clean, global_alcohol_tax_cost),
        single: calcPricing(single_price_clean, 1, global_alcohol_tax_cost),
        single_special: calcPricing(single_promo_clean, single_promo_size_clean, global_alcohol_tax_cost)
      };
      
      const finalPricing = {};
      for (const [key, group] of Object.entries(pricingGroups)) {
        if (group !== null && group.cost_per_standard !== null) {
          finalPricing[key] = group;
        }
      }
      
      const outRecord = {
        stockcode,
        properties: {
          ...properties,
          // Update property field names per requirements.
          percentage_raw,
          standard_drinks_raw,
          standard_drinks_clean: properties.standard_drinks_clean || standard_drinks_raw
        },
        pricing: finalPricing
      };
      
      output.push(outRecord);
    }
    
    // Write final output to beer.json in datasets_cleaned.
    const outputPath = path.join(__dirname, '..', 'datasets_cleaned', 'beer.json');
    await fs.writeFile(outputPath, JSON.stringify(output, null, 2), 'utf8');
    console.log(`Output written to ${outputPath}`);
  } catch (err) {
    console.error("Error processing beer:", err);
  }
}

// Call the main function
processBeer().catch(err => {
  console.error("Error:", err);
  process.exit(1);
});
