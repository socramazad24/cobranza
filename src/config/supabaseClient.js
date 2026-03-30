// src/config/supabaseClient.js
const { createClient } = require('@supabase/supabase-js');

let supabase;

const getSupabase = () => {
  if (!supabase) {
    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_KEY;

    console.log('SUPABASE_URL:', url ? '✅' : '❌ undefined');
    console.log('SUPABASE_KEY:', key ? '✅' : '❌ undefined');

    supabase = createClient(url, key);
  }
  return supabase;
};

module.exports = getSupabase;