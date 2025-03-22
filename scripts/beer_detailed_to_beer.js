const fs = require('fs/promises');
const path = require('path');

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
// Logs an error if no number is found.
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

async function processBeer2() {
  try {
    // Input and output paths (assumed to be in ../datasets_cleaned/)
    const inputPath = path.join(__dirname, '..', 'datasets_cleaned', 'beer_detailed.json');
    const outputPath = path.join(__dirname, '..', 'datasets_cleaned', 'beer_2.json');
    const dataContent = await fs.readFile(inputPath, 'utf8');
    const beers = JSON.parse(dataContent);

    const output = [];
    // Regex for cleaning name
    const nameCleanPattern = /(\s*((?:(?:bottles?|cans?|longnecks?)\s*)?\d+(?:\s*[Xx]\s*\d+)*(?:\s*mL)(?:\s*(?:bottles?|cans?|longnecks?))?(?:\s*\(.*\))?))$/i;

    for (const record of beers) {
      const stockcode = record.stockcode;

      // --- PROPERTIES TRANSFORMATIONS ---
      const name = record.name || "";
      const name_clean = name.replace(nameCleanPattern, '').trim();
      const brand = record.brand || null;

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

      let raw_percent = null;
      if (record.percent) {
        const percentStr = record.percent.substring(0, 4).replace('%', '');
        raw_percent = safeConvertNumber(percentStr, "percent", stockcode);
      }

      let raw_standard_drinks = null;
      if (record.standard_drinks) {
        raw_standard_drinks = safeConvertNumber(record.standard_drinks, "standard_drinks", stockcode);
      }
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

      const properties = {
        name,
        name_clean,
        brand,
        size_ml,
        raw_percent,
        raw_standard_drinks,
        image_url,
        rating,
        ibu,
        beer_style
      };

      // --- PRICING TRANSFORMATIONS ---
      let promo_type_clean = null;
      let promo_multiplier_clean = null;
      const promo_type = record.promo_type;
      if (promo_type) {
        const promo_lower = promo_type.toLowerCase();
        // Plurals take precedence
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

      // Pack and Single Pricing
      let pack_price_clean = null;
      let pack_promo_clean = null;
      let pack_size_clean = null;
      let pack_size_promo_clean = null;
      let single_price_clean = null;
      let single_promo_clean = null;
      let single_exists = false;
      // New field for single promo size
      let single_promo_size_clean = null;
      const pack_type = record.pack_type ? record.pack_type.toLowerCase() : null;
      let packScenarioDetermined = false;

      if (pack_type && (pack_type.includes("each") || pack_type.includes("bottle"))) {
        // Edge case: if promo_type_clean equals "single", use pack fields for single pricing.
        if (promo_type_clean === 'single') {
          single_price_clean = record.pack_price;
          single_promo_clean = record.pack_promo;
          single_promo_size_clean = promo_multiplier_clean;
          // Clear pack pricing fields.
          pack_price_clean = null;
          pack_promo_clean = null;
          pack_size_clean = null;
          pack_size_promo_clean = null;
          packScenarioDetermined = true;
        } else {
          // Normal "each" scenario
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
      // Default Pack Scenario: for pack types that are not "each" or "bottle"
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

      // Determine singles pricing if not already set from pack scenario.
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

      const pricing = {
        promo_type_clean,
        promo_multiplier_clean,
        case_price_clean,
        case_promo_clean,
        case_size_clean,
        case_size_promo_clean,
        case_exists,
        pack_price_clean,
        pack_promo_clean,
        pack_size_clean,
        pack_size_promo_clean,
        single_price_clean,
        single_promo_clean,
        single_exists,
        single_promo_size_clean
      };

      const outRecord = {
        stockcode,
        properties,
        pricing
      };

      output.push(outRecord);
    }

    await fs.writeFile(outputPath, JSON.stringify(output, null, 2), 'utf8');
    console.log(`Output written to ${outputPath}`);
  } catch (err) {
    console.error("Error processing beer_2:", err);
  }
}

processBeer2();
