import { supabase } from '../supabase';

/**
 * The customer with this email (already lower-cased), created if new.
 * customersByEmail: Map of lower-cased email -> { id, email } already loaded.
 * @returns {Promise<{ customer: { id, email }, created: boolean }>}
 */
export async function findOrCreateCustomer(email, customersByEmail) {
  const known = customersByEmail.get(email);
  if (known) return { customer: known, created: false };
  const { data, error } = await supabase.from('customers').insert({ email }).select('id, email').single();
  if (!error) return { customer: data, created: true };
  // created meanwhile (or list out of date): use the existing one
  const { data: found } = await supabase.from('customers').select('id, email').ilike('email', email).maybeSingle();
  if (!found) throw error;
  return { customer: found, created: false };
}
