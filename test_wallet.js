const axios = require('axios');
require('dotenv').config();

const addr = 'UQDNItVDUjs9tefv7xdrqgw44jwzF7xzoEI11fQXCJGorojeE'; // Alex2
const url = `https://tonapi.io/v2/accounts/${addr}/nfts`;

console.log('--- TEST START ---');
console.log('Wallet:', addr);
console.log('URL:', url);

axios.get(url, {
  headers: process.env.TONAPI_KEY ? { Authorization: `Bearer ${process.env.TONAPI_KEY}` } : {}
})
.then(res => {
  console.log('✅ SUCCESS!');
  console.log('NFTs Found:', res.data.nft_items?.length);
})
.catch(err => {
  console.log('❌ ERROR!');
  console.log('Status:', err.response?.status);
  console.log('Message:', err.message);
  console.log('Details from TonAPI:', JSON.stringify(err.response?.data, null, 2));
});
