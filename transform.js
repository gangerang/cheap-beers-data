const fs = require('fs');

// Helper functions
function tryParseFloat(val) {
  const num = parseFloat(val);
  return isNaN(num) ? 0 : num;
}

function tryParseInt(val) {
  const num = parseInt(val, 10);
  return isNaN(num) ? 0 : num;
}

function roundTo(num, decimals) {
  return Math.round(num * Math.pow(10, decimals)) / Math.pow(10, decimals);
}

/**
 * Helper to clean the product name and extract vessel type.
 *
 * This function removes a trailing pattern from the name that refers
 * to vessel type, quantity, and size (e.g., "Cans 6X500mL", "Bottle6X375mL",
 * "330mL", etc.). It uses a regex to remove such trailing text.
 *
 * It also checks for the presence of keywords "bottle", "can", or "longneck"
 * (in any case and singular/plural) anywhere in the name and, if found,
 * returns the canonical vessel value.
 */
function cleanNameAndVessel(name) {
  // Regex explanation:
  // This pattern looks for a trailing block at the end of the name which may consist of:
  // - Optional whitespace
  // - Either a vessel keyword (bottle, bottles, can, cans, longneck, longnecks)
  //   possibly followed by some numbers and/or "x" characters,
  //   OR just a number (for cases like "330mL")
  // - Followed by optional whitespace and the literal "mL" (case-insensitive)
  // - Optionally followed by text in parentheses (like "(Block)")
  // - also when vessel is before size
  // The pattern is applied case-insensitively.
  const pattern = /(\s*((?:(?:bottles?|cans?|longnecks?)\s*)?\d+(?:\s*[Xx]\s*\d+)*(?:\s*mL)(?:\s*(?:bottles?|cans?|longnecks?))?(?:\s*\(.*\))?))$/i;
  const name_clean = name.replace(pattern, '').trim();

  let vessel;
  if (/bottles?/i.test(name)) {
    vessel = 'bottle';
  } else if (/cans?/i.test(name)) {
    vessel = 'can';
  } else if (/longnecks?/i.test(name)) {
    vessel = 'longneck';
  }

  return { name_clean, vessel };
}


// Read the input JSON (assumed to be in the root of the repo)
let rawData;
try {
  rawData = fs.readFileSync('beer.json', 'utf8');
} catch (err) {
  console.error("Error reading beer.json:", err);
  process.exit(1);
}

let beers;
try {
  beers = JSON.parse(rawData);
} catch (err) {
  console.error("Error parsing JSON:", err);
  process.exit(1);
}

// Step 1: Transform raw records (similar to CTE "beer_2")
const beer2 = beers.map(beer => ({
  stockcode: beer.stockcode,
  name: beer.name,
  units_pack: beer.units ? beer.units.pack : null,
  units_case: beer.units ? beer.units.case : null,
  prices_bottle: beer.prices ? beer.prices.bottle : null,
  prices_pack: beer.prices ? beer.prices.pack : null,
  prices_case: beer.prices ? beer.prices.case : null,
  prices_promo_bottle: beer.prices ? beer.prices.promobottle : null,
  prices_promo_pack: beer.prices ? beer.prices.promopack : null,
  prices_promo_case: beer.prices ? beer.prices.promocase : null,
  standardDrinks: beer.standardDrinks,
  percentage: beer.percentage
}));

// Step 2: Base transformation (casting & extracting values)
const base = beer2.map(row => {
  // Convert strings to numbers
  const standard_drinks = tryParseFloat(row.standardDrinks);
  const percentage_str = (row.percentage || "").substring(0, 4).replace('%', '');
  const percentage_numeric = tryParseFloat(percentage_str);
  const prices_bottle = tryParseFloat(row.prices_bottle);
  const prices_pack = tryParseFloat(row.prices_pack);
  const prices_case = tryParseFloat(row.prices_case);
  const prices_promo_bottle = tryParseFloat(row.prices_promo_bottle);
  const prices_promo_pack = tryParseFloat(row.prices_promo_pack);
  const prices_promo_case = tryParseFloat(row.prices_promo_case);
  const units_pack = tryParseInt(row.units_pack);
  const units_case = tryParseInt(row.units_case);

  // Extract size_from_name using regex (e.g. "375ml" or "50 m")
  let size_from_name = null;
  const sizeMatch = row.name.match(/([0-9]{2,4})\s?m/i);
  if (sizeMatch) {
    size_from_name = tryParseInt(sizeMatch[1]);
  }

  return {
    name: row.name,
    stockcode: row.stockcode,
    standard_drinks,
    percentage_numeric,
    prices_bottle,
    prices_pack,
    prices_case,
    prices_promo_bottle,
    prices_promo_pack,
    prices_promo_case,
    units_pack,
    units_case,
    size_from_name
  };
});

// Step 3: Adjust percentage (CTE "adjusted")
const adjusted = base.map(row => {
  let adjusted_percentage = row.percentage_numeric;
  if (row.percentage_numeric < 0.1 && row.standard_drinks !== 0) {
    adjusted_percentage = row.percentage_numeric * 100;
  }
  return { ...row, adjusted_percentage };
}).filter(row => row.standard_drinks > 0 && row.adjusted_percentage > 0);

// Step 4: Correct values (CTE "corrected")
const corrected = adjusted.map(row => {
  // Determine size: if size_from_name exists, use it. Otherwise compute as: round(standard_drinks * 1267 / adjusted_percentage)
  const size = (row.size_from_name !== null) ? row.size_from_name : Math.round(row.standard_drinks * 1267 / row.adjusted_percentage);
  
  // Compute the candidate standard drinks: round(adjusted_percentage * size / 1267, 1)
  const computedStandard = roundTo(row.adjusted_percentage * size / 1267, 1);
  const standard_drinks_corrected = (Math.abs(row.standard_drinks - computedStandard) > 0.1) ? computedStandard : row.standard_drinks;
  
  return {
    name: row.name,
    stockcode: row.stockcode,
    percentage: row.adjusted_percentage,
    size,
    standard_drinks_corrected,
    prices_bottle: row.prices_bottle,
    prices_pack: row.prices_pack,
    prices_case: row.prices_case,
    prices_promo_bottle: row.prices_promo_bottle,
    prices_promo_pack: row.prices_promo_pack,
    prices_promo_case: row.prices_promo_case,
    units_pack: row.units_pack,
    units_case: row.units_case
  };
});

// Step 5: Build raw options (CTE "raw_options")
let raw_options = [];
corrected.forEach(row => {
  if (row.prices_bottle > 0) {
    raw_options.push({
      name: row.name,
      stockcode: row.stockcode,
      percentage: row.percentage,
      size: row.size,
      standard_drinks_corrected: row.standard_drinks_corrected,
      special: false,
      package: 'bottle',
      package_size: 1,
      total_price: row.prices_bottle
    });
  }
  if (row.prices_promo_bottle > 0) {
    raw_options.push({
      name: row.name,
      stockcode: row.stockcode,
      percentage: row.percentage,
      size: row.size,
      standard_drinks_corrected: row.standard_drinks_corrected,
      special: true,
      package: 'bottle',
      package_size: 1,
      total_price: row.prices_promo_bottle
    });
  }
  if (row.prices_pack > 0 && row.units_pack > 0) {
    raw_options.push({
      name: row.name,
      stockcode: row.stockcode,
      percentage: row.percentage,
      size: row.size,
      standard_drinks_corrected: row.standard_drinks_corrected,
      special: false,
      package: 'pack',
      package_size: row.units_pack,
      total_price: row.prices_pack
    });
  }
  if (row.prices_promo_pack > 0 && row.units_pack > 0) {
    raw_options.push({
      name: row.name,
      stockcode: row.stockcode,
      percentage: row.percentage,
      size: row.size,
      standard_drinks_corrected: row.standard_drinks_corrected,
      special: true,
      package: 'pack',
      package_size: row.units_pack,
      total_price: row.prices_promo_pack
    });
  }
  if (row.prices_case > 0 && row.units_case > 0) {
    raw_options.push({
      name: row.name,
      stockcode: row.stockcode,
      percentage: row.percentage,
      size: row.size,
      standard_drinks_corrected: row.standard_drinks_corrected,
      special: false,
      package: 'case',
      package_size: row.units_case,
      total_price: row.prices_case
    });
  }
  if (row.prices_promo_case > 0 && row.units_case > 0) {
    raw_options.push({
      name: row.name,
      stockcode: row.stockcode,
      percentage: row.percentage,
      size: row.size,
      standard_drinks_corrected: row.standard_drinks_corrected,
      special: true,
      package: 'case',
      package_size: row.units_case,
      total_price: row.prices_promo_case
    });
  }
});

// Step 6: Clean the results (CTE "cleaned")
// Also add the online_only, name_clean, and vessel enhancements.
let cleaned = raw_options.map(option => {
  const total_price = roundTo(option.total_price, 2);
  const unit_price = option.package_size !== 0 ? roundTo(total_price / option.package_size, 2) : 0;
  const cost_per_standard = option.standard_drinks_corrected !== 0 ? roundTo(unit_price / option.standard_drinks_corrected, 2) : 0;
  
  // Get cleaned name and vessel information
  const { name_clean, vessel } = cleanNameAndVessel(option.name);
  
// In the mapping for the final cleaned record:
return {
    name: option.name,
    name_clean, // cleaned name with trailing vessel/size info removed
    stockcode: option.stockcode,
    percentage: option.percentage,
    size: option.size,
    standard_drinks: option.standard_drinks_corrected,
    special: option.special,
    package: option.package === 'bottle' ? 'single' : option.package, // updated here
    package_size: option.package_size,
    total_price,
    unit_price,
    cost_per_standard,
    ...(option.stockcode.startsWith("ER") ? { online_only: true } : {}),
    ...(vessel ? { vessel } : {})
  };  
}).filter(option =>
  option.total_price > 0 &&
  option.package_size > 0 &&
  option.standard_drinks > 0 &&
  option.cost_per_standard > 0.5
);

// Final sort: by stockcode, then package_size, then special (true before false)
cleaned.sort((a, b) => {
  if (a.stockcode < b.stockcode) return -1;
  if (a.stockcode > b.stockcode) return 1;
  if (a.package_size < b.package_size) return -1;
  if (a.package_size > b.package_size) return 1;
  // special: true comes before false
  if (a.special === b.special) return 0;
  return a.special ? -1 : 1;
});

// Write the output to beer_corrected.json
try {
  fs.writeFileSync('beer_corrected.json', JSON.stringify(cleaned, null, 2));
  console.log('beer_corrected.json has been created successfully.');
} catch (err) {
  console.error("Error writing beer_corrected.json:", err);
  process.exit(1);
}
