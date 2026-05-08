const axios = require('axios');
require('dotenv').config();

const addr = 'UQDNItVDUjs9tefv7xdrqgw44jwzF7xzoEI11fQXCJGorojeE';
const url = `https://tonapi.io/v2/accounts/${addr}/nfts`;

console.log('Testing URL:', url);
console.log('Using Key:', process.env.TONAPI_KEY ? 'YES' : 'NO');

axios.get(url, {
  headers: process.env.TONAPI_KEY ? { Authorization: `Bearer ${process.env.TONAPI_KEY}` } : {}
})
.then(res => {
  console.log('SUCCESS!');
  console.log('NFT count:', res.data.nft_items?.length);
})
.catch(err => {
  console.log('ERROR 400 Details:');
  console.log(err.response?.data || err.message);
});
