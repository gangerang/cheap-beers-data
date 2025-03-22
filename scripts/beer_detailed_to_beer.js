const fs = require('fs/promises');
const path = require('path');

// Helper function to round to a given number of decimals.
function roundTo(value, decimals) {
  return Math.round(value * Math.pow(10, decimals)) / Math.pow(10, decimals);
}

// Helper function: safely convert a value to a number.
// If conversion fails, log an error with stockcode, field name, and attempted value.
function safeConvertNumber(value, fieldName, stockcode) {
  const num = Number(value);
  if (isNaN(num)) {
    console.error(`Conversion error for stockcode ${stockcode}: field ${fieldName} with value ${value}`);
    return null;
  }
  return num;
}

// Helper function: extract the first numeric value from a string.
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
  try {
    // Input and output paths (assumed to be in ../datasets_cleaned/)
    const inputPath = path.join(__dirname, '..', 'datasets_cleaned', 'beer_detailed.json');
    const outputPath = path.join(__dirname, '..', 'datasets_cleaned', 'beer.json');
    const dataContent = await fs.readFile(inputPath, 'utf8');
    const beers = JSON.parse(dataContent);
    const output = [];

    // Regex to remove trailing size info from name.
    const nameCleanPattern = /(\s*((?:(?:bottles?|cans?|longnecks?)\s*)?\d+(?:\s*[Xx]\s*\d+)*(?:\s*mL)(?:\s*(?:bottles?|cans?|longnecks?))?(?:\s*\(.*\))?))$/i;

    for (const record of beers) {
      const stockcode = record.stockcode;

      // --- PROPERTIES TRANSFORMATIONS ---

      const name = record.name || "";
      const name_clean = name.replace(nameCleanPattern, '').trim();
      const brand = record.brand || null;

      // size_ml: extract number from record.size; if less than 5, assume liters.
      let size_ml = null;
      if (record.size) {
        const extracted = extractNumberFromString(record.size, "size", stockcode);
        if (extracted !== null) {
          size_ml = extracted;
          if (size_ml < 5) {
            size_ml = size_ml * 1000;
          }
        }
      }

      // raw_percent: take first 4 characters (remove %), convert to number.
      let raw_percent = null;
      if (record.percent) {
        const percentStr = record.percent.substring(0, 4).replace('%', '');
        raw_percent = safeConvertNumber(percentStr, "percent", stockcode);
      }

      // raw_standard_drinks: convert to number.
      let raw_standard_drinks = null;
      if (record.standard_drinks) {
        raw_standard_drinks = safeConvertNumber(record.standard_drinks, "standard_drinks", stockcode);
      }
      // If raw_percent is very low and standard_drinks is nonzero, adjust percent.
      if (raw_percent !== null && raw_percent < 0.1 && raw_standard_drinks && raw_standard_drinks !== 0) {
        raw_percent = raw_percent * 100;
      }

      const image_url = record.image_url || null;

      let rating = null;
      if (record.rating !== undefined && record.rating !== null) {
        rating = safeConvertNumber(record.rating, "rating", stockcode);
        if (rating !== null) {
          rating = Math.round(rating * 10) / 10;
        }
      }

      let ibu = null;
      if (record.ibu) {
        ibu = safeConvertNumber(record.ibu, "ibu", stockcode);
      }
      const beer_style = record.beer_style || null;

      // vessel: determine if bottle, can, or longneck based on name.
      let vessel = null;
      if (/bottles?/i.test(name)) {
        vessel = 'bottle';
      } else if (/cans?/i.test(name)) {
        vessel = 'can';
      } else if (/longnecks?/i.test(name)) {
        vessel = 'longneck';
      }

      // size_clean: extract an exact 3-digit number from name; if not, check size_ml.
      let size_clean = null;
      const nameSizeMatch = name.match(/\b(\d{3})\b/);
      if (nameSizeMatch) {
        size_clean = parseInt(nameSizeMatch[1], 10);
      } else if (size_ml !== null && String(size_ml).length === 3) {
        size_clean = size_ml;
      }

      // Rename raw fields.
      const percentage_raw = raw_percent;
      const standard_drinks_raw = raw_standard_drinks;

      // standard_drinks_clean: calculate as (percentage_raw * size_clean)/1267 rounded to 1 dp.
      let standard_drinks_clean = null;
      if (size_clean !== null && percentage_raw !== null) {
        const calc = Number(((percentage_raw * size_clean) / 1267).toFixed(1));
        if (standard_drinks_raw !== null && Math.abs(calc - standard_drinks_raw) < 0.1) {
          standard_drinks_clean = standard_drinks_raw;
        } else {
          standard_drinks_clean = calc;
        }
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

      // --- Compute Global Alcohol Tax Values ---
      // Assume alcohol_fraction = percentage_raw / 100.
      const alcohol_fraction = properties.percentage_raw ? properties.percentage_raw / 100 : 0;
      const taxable_alcohol_fraction = Math.max(alcohol_fraction - 0.0115, 0);
      const taxable_volume = properties.size_ml ? (properties.size_ml / 1000) * taxable_alcohol_fraction : 0;
      const tax_rate = (alcohol_fraction <= 0.03) ? 52.66 : 61.32;
      const total_tax = taxable_volume * tax_rate;
      const global_alcohol_tax_cost = (properties.standard_drinks_clean && properties.standard_drinks_clean > 0)
        ? roundTo(total_tax / properties.standard_drinks_clean, 2)
        : 0;

      // --- PRICING TRANSFORMATIONS ---
      let promo_type_clean = null;
      let promo_multiplier_clean = null;
      const promo_type = record.promo_type;
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

      const case_price_clean = (record.case_price !== undefined) ? record.case_price : null;
      let case_promo_clean = (record.case_promo === null || record.case_promo === 0) ? null : record.case_promo;

      let case_size_clean = null;
      if (record.case_type && typeof record.case_type === "string") {
        const numMatch = record.case_type.match(/\d+/);
        if (numMatch) {
          case_size_clean = parseInt(numMatch[0], 10);
          if (isNaN(case_size_clean)) {
            console.error(`Conversion error for stockcode ${stockcode}: field case_size_clean from case_type with value "${record.case_type}"`);
            case_size_clean = null;
          }
        }
      }
      if (case_size_clean === null && record.case_size) {
        case_size_clean = safeConvertNumber(record.case_size, "case_size", stockcode);
        if (case_size_clean === 0) {
          case_size_clean = null;
        }
      }

      let case_size_promo_clean = null;
      if (record.promo_price === record.case_promo && case_size_clean !== null && promo_multiplier_clean !== null) {
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
      const pack_type = record.pack_type ? record.pack_type.toLowerCase() : null;
      let packScenarioDetermined = false;

      if (pack_type && (pack_type.includes("each") || pack_type.includes("bottle"))) {
        // Edge case: if promo_type_clean equals "single", then special handling for singles.
        if (promo_type_clean === 'single') {
          single_price_clean = record.pack_price;
          single_promo_clean = record.pack_promo;
          single_promo_size_clean = promo_multiplier_clean;
          pack_price_clean = null;
          pack_promo_clean = null;
          pack_size_clean = null;
          pack_size_promo_clean = null;
          packScenarioDetermined = true;
        } else {
          const packPrice = safeConvertNumber(record.pack_price, "pack_price", stockcode);
          const packPromo = safeConvertNumber(record.pack_promo, "pack_promo", stockcode);
          if (packPrice !== null && packPromo !== null && packPrice > packPromo) {
            if (record.single_price && safeConvertNumber(record.single_price, "single_price", stockcode) !== 0) {
              single_price_clean = record.single_price;
              single_promo_clean = record.single_promo;
            } else {
              single_price_clean = record.pack_price;
              single_promo_clean = record.pack_promo;
            }
            packScenarioDetermined = true;
          } else if (packPrice !== null && packPromo !== null && packPromo > packPrice && packPromo !== 0) {
            pack_promo_clean = record.pack_promo;
            pack_size_clean = null;
            pack_price_clean = null;
          }
        }
      }
      // Default Pack Scenario: for pack types not including "each" or "bottle".
      if (!packScenarioDetermined) {
        pack_price_clean = record.pack_price;
        pack_promo_clean = record.pack_promo;
        if (pack_type) {
          const numMatch = pack_type.match(/\d+/);
          if (numMatch) {
            pack_size_clean = parseInt(numMatch[0], 10);
            if (isNaN(pack_size_clean)) {
              console.error(`Conversion error for stockcode ${stockcode}: field pack_size_clean from pack_type with value "${record.pack_type}"`);
              pack_size_clean = null;
            }
          }
        }
        if (!pack_size_clean && record.pack_size) {
          pack_size_clean = safeConvertNumber(record.pack_size, "pack_size", stockcode);
          if (pack_size_clean === 0) {
            pack_size_clean = null;
          }
        }
      }

      // Now, if pack_promo_clean exists, compute pack_size_promo_clean.
      if (pack_promo_clean !== null) {
        if (promo_type_clean === 'pack' && pack_size_clean !== null && promo_multiplier_clean !== null) {
          pack_size_promo_clean = pack_size_clean * promo_multiplier_clean;
        } else {
          pack_size_promo_clean = pack_size_clean;
        }
      }

      if (!packScenarioDetermined) {
        if (record.single_price && safeConvertNumber(record.single_price, "single_price", stockcode) !== 0) {
          single_price_clean = record.single_price;
        } else {
          single_price_clean = null;
        }
      }
      if (single_price_clean !== null) {
        single_exists = true;
      }

      // --- NEW PRICING STRUCTURE ---
      // Build a helper function for pricing groups.
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

      // Compute pricing groups using our calcPricing function.
      const pricingGroups = {
        case: calcPricing(case_price_clean, case_size_clean, global_alcohol_tax_cost),
        case_special: calcPricing(case_promo_clean, case_size_promo_clean, global_alcohol_tax_cost),
        pack: calcPricing(pack_price_clean, pack_size_clean, global_alcohol_tax_cost),
        pack_special: calcPricing(pack_promo_clean, pack_size_promo_clean, global_alcohol_tax_cost),
        single: calcPricing(single_price_clean, 1, global_alcohol_tax_cost),
        single_special: calcPricing(single_promo_clean, single_promo_size_clean, global_alcohol_tax_cost)
      };

      // Only include pricing groups with non-null total_price.
      const finalPricing = {};
      for (const [key, group] of Object.entries(pricingGroups)) {
        if (group !== null && group.total_price !== null) {
          finalPricing[key] = group;
        }
      }

      const outRecord = {
        stockcode,
        properties,
        pricing: finalPricing
      };

      output.push(outRecord);
    }

    await fs.writeFile(outputPath, JSON.stringify(output, null, 2), 'utf8');
    console.log(`Output written to ${outputPath}`);
  } catch (err) {
    console.error("Error processing beer:", err);
  }
}

processBeer();
