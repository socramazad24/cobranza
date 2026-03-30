// src/config/supabaseClient.js
const { createClient } = require('@supabase/supabase-js');

console.log('ENV CHECK:', {
  url: process.env.SUPABASE_URL,
  key: process.env.SUPABASE_SERVICE_KEY ? '✅ existe' : '❌ undefined',
  port: process.env.PORT,
  node_env: process.env.NODE_ENV
});

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