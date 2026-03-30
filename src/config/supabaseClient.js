// src/config/supabaseClient.js
const { createClient } = require('@supabase/supabase-js');

console.log('ENV CHECK:', {
  url: process.env.SB_URL,
  key: process.env.SB_KEY ? '✅ existe' : '❌ undefined',
  port: process.env.PORT,
  node_env: process.env.NODE_ENV
});

let supabase;

const getSupabase = () => {
  if (!supabase) {
    const url = process.env.SB_URL;
    const key = process.env.SB_KEY;

    console.log('SB_URL:', url ? '✅' : '❌ undefined');
    console.log('SB_KEY:', key ? '✅' : '❌ undefined');

    supabase = createClient(url, key);
  }
  return supabase;
};

module.exports = getSupabase;