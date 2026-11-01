/**
 * Shared domain types for the Leclerc Drive MCP server.
 *
 * These are the shapes the MCP tools expose to the model. The raw shapes
 * returned by the Leclerc Drive backend are mapped into these in the client
 * layer (see src/leclerc/client.ts) once the API has been reverse-engineered.
 */

export interface Product {
  /** Stable product identifier used by add_to_cart / update_quantity. */
  id: string;
  /** Display label, e.g. "Lait demi-écrémé Bio 1L". */
  label: string;
  /** Brand, e.g. "Marque Repère". Optional — not always present. */
  brand?: string;
  /** Unit price in euros, e.g. 1.29. */
  price: number;
  /** Price per kilo / litre when the site exposes it, e.g. "1,29 €/L". */
  pricePerUnit?: string;
  /** Nutri-Score letter A–E, when available. */
  nutriScore?: string;
  /** Whether the item is currently orderable in the selected store. */
  available: boolean;
  /** Thumbnail image URL, when available. */
  imageUrl?: string;
}

export interface CartItem {
  product: Product;
  quantity: number;
  /** quantity * unit price, in euros. */
  lineTotal: number;
}

export interface Cart {
  items: CartItem[];
  /** Number of units in the cart (sum of the line quantities), as Leclerc counts items. */
  itemCount: number;
  /** Sum of all line totals, in euros. */
  total: number;
  storeId: string;
}

/** What a single cart change did, as Leclerc Drive confirmed it. */
export interface CartChange {
  productId: string;
  /** The line's quantity now (0 if removed). */
  quantity: number;
  /** The line now, when it is still in the cart. */
  line?: CartItem;
  /** True when Leclerc Drive kept less than asked (stock or per-order limit). */
  limited: boolean;
  /** Cart grand total after the change, in euros, when Leclerc reports it. */
  cartTotal?: number;
  /** Units in the cart after the change, when Leclerc reports it. */
  cartItemCount?: number;
}

export interface AddManyItemResult {
  productId: string;
  requested: number;
  ok: boolean;
  change?: CartChange;
  error?: string;
}

export interface AddManyResult {
  results: AddManyItemResult[];
  /** The cart after the batch; missing if it could not be read (see cartError). */
  cart?: Cart;
  cartError?: string;
}
