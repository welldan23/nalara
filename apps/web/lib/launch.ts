// Launch state for search engines (P1-08, ADR-015). The API is the single source of truth for
// the launch flag: before launch its public routes answer 404, so the web app cannot ask search
// engines to index anything the API would not serve.
import { publicCategories } from './public-api';

/**
 * True only when the public API answers. Fails closed: if the API is down or not launched,
 * pages say noindex, robots.txt disallows everything and the sitemap is empty.
 */
export async function siteLaunched(): Promise<boolean> {
  try {
    return (await publicCategories()) !== null;
  } catch {
    return false;
  }
}
