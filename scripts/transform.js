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

// Read and parse the input JSON file
let rawData;
try {
  rawData = fs.readFileSync('datasets_raw/beer.json', 'utf8');
} catch (err) {
  console.error("Error reading datasets_raw/beer.json:", err);
  process.exit(1);
}

let beers;
try {
  beers = JSON.parse(rawData);
} catch (err) {
  console.error("Error parsing JSON:", err);
  process.exit(1);
}

/**
 * Process a single beer record into an array of cleaned options.
 * Returns an empty array if the record is invalid.
 */
function processBeerRecord(beer) {
  if (!beer.name) {
    console.log(`Skipping record with missing name, stockcode: ${beer.stockcode}`);
    return [];
  }

  // Extract and parse values
  const stockcode = beer.stockcode;
  const name = beer.name;
  const units_pack = beer.units ? tryParseInt(beer.units.pack) : 0;
  const units_case = beer.units ? tryParseInt(beer.units.case) : 0;
  const prices_bottle = beer.prices ? tryParseFloat(beer.prices.bottle) : 0;
  const prices_pack = beer.prices ? tryParseFloat(beer.prices.pack) : 0;
  const prices_case = beer.prices ? tryParseFloat(beer.prices.case) : 0;
  const prices_promo_bottle = beer.prices ? tryParseFloat(beer.prices.promobottle) : 0;
  const prices_promo_pack = beer.prices ? tryParseFloat(beer.prices.promopack) : 0;
  const prices_promo_case = beer.prices ? tryParseFloat(beer.prices.promocase) : 0;
  const standardDrinks = tryParseFloat(beer.standardDrinks);
  let percentage_numeric = tryParseFloat((beer.percentage || "").substring(0, 4).replace('%', ''));

  // Adjust percentage if likely mis-parsed
  if (percentage_numeric < 0.1 && standardDrinks !== 0) {
    percentage_numeric *= 100;
  }
  // Ensure valid record based on drinks and percentage
  if (standardDrinks <= 0 || percentage_numeric <= 0) return [];

  // Try to extract size from name (e.g., "375mL")
  let size_from_name = null;
  const sizeMatch = name.match(/([0-9]{2,4})\s?m/i);
  if (sizeMatch) {
    size_from_name = tryParseInt(sizeMatch[1]);
  }
  // Determine size: use extracted size or compute it if missing
  const size = (size_from_name !== null) ? size_from_name : Math.round(standardDrinks * 1267 / percentage_numeric);
  // Recompute standard drinks and adjust if significantly different
  const computedStandard = roundTo(percentage_numeric * size / 1267, 1);
  const standard_drinks_corrected = (Math.abs(standardDrinks - computedStandard) > 0.1) ? computedStandard : standardDrinks;

  // Build option objects from available pricing info
  const options = [];
  function addOption(price, special, pkg, pkgSize) {
    if (price > 0 && pkgSize > 0) {
      options.push({
        name,
        stockcode,
        percentage: percentage_numeric,
        size,
        standard_drinks_corrected,
        special,
        package: pkg,
        package_size: pkgSize,
        total_price: price
      });
    }
  }
  addOption(prices_bottle, false, 'bottle', 1);
  addOption(prices_promo_bottle, true, 'bottle', 1);
  addOption(prices_pack, false, 'pack', units_pack);
  addOption(prices_promo_pack, true, 'pack', units_pack);
  addOption(prices_case, false, 'case', units_case);
  addOption(prices_promo_case, true, 'case', units_case);

  // Clean and enhance each option
  return options.map(option => {
    const total_price = roundTo(option.total_price, 2);
    const unit_price = option.package_size ? roundTo(total_price / option.package_size, 2) : 0;
    const cost_per_standard = option.standard_drinks_corrected ? roundTo(unit_price / option.standard_drinks_corrected, 2) : 0;
    const { name_clean, vessel } = cleanNameAndVessel(option.name);

    // Alcohol tax calculations
    const alcohol_fraction = option.percentage / 100;
    const calc_std_drinks = (alcohol_fraction * option.size) / 12.67;
    const taxable_alcohol_fraction = Math.max(alcohol_fraction - 0.0115, 0);
    const taxable_volume = (option.size / 1000) * taxable_alcohol_fraction;
    const tax_rate = (alcohol_fraction <= 0.03) ? 52.66 : 61.32;
    const total_tax = taxable_volume * tax_rate;
    const alcohol_tax_cost = calc_std_drinks > 0 ? roundTo(total_tax / calc_std_drinks, 2) : 0;
    const alcohol_tax_percent = cost_per_standard > 0 ? roundTo((alcohol_tax_cost / cost_per_standard) * 100, 0) : 0;

    return {
      name: option.name,
      name_clean,
      stockcode: option.stockcode,
      percentage: option.percentage,
      size: option.size,
      standard_drinks: option.standard_drinks_corrected,
      special: option.special,
      package: option.package === 'bottle' ? 'single' : option.package,
      package_size: option.package_size,
      total_price,
      unit_price,
      cost_per_standard,
      ...(option.stockcode.startsWith("ER") ? { online_only: true } : {}),
      ...(vessel ? { vessel } : {}),
      alcohol_tax_cost,
      alcohol_tax_percent
    };
  }).filter(option =>
    option.total_price > 0 &&
    option.package_size > 0 &&
    option.standard_drinks > 0 &&
    option.cost_per_standard > 0.5 &&
    !/cider/i.test(option.name)
  );
}

// Process all beer records and flatten the results into a single array
const cleanedOptions = beers.reduce((acc, beer) => acc.concat(processBeerRecord(beer)), []);

// Final sort: by stockcode, then package_size, then with special options first
cleanedOptions.sort((a, b) => {
  if (a.stockcode < b.stockcode) return -1;
  if (a.stockcode > b.stockcode) return 1;
  if (a.package_size < b.package_size) return -1;
  if (a.package_size > b.package_size) return 1;
  return a.special === b.special ? 0 : (a.special ? -1 : 1);
});

// Write the output to beer_cleaned.json
try {
  fs.writeFileSync('datasets_cleaned/beer_cleaned.json', JSON.stringify(cleanedOptions, null, 2));
  console.log('beer_cleaned.json has been created successfully.');
} catch (err) {
  console.error("Error writing beer_cleaned.json:", err);
  process.exit(1);
}
