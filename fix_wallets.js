const { query } = require('./src/db');

const oldWallets = [
  { name: "Alex1", address: "UQDq8mAR0vaK1iHEq_1UuLoXmPLwZ5nUdjM_GTRX87YZdnhp", index: 1 },
  { name: "Alex2", address: "UQDNItVDUjs9tefv7xdrQgW44jWzF7xzoEI11fQXCJGOrojE", index: 2 },
  { name: "Alex3", address: "UQA_MxFfYpkF0yXSyugYme5pZQEre92BOgxELUonYAI6nXEn", index: 3 },
  { name: "Alex4", address: "UQDQ30x50nf3aHz7Olj2xxBXV_b3_364DXyqyEPsxTKCDVal", index: 4 },
  { name: "Den1", address: "UQDSG8EPkjDOTMtNPcv3FMZfkmT1VmFq_nHGBsfqgF932xDf", index: 5 },
  { name: "Den2", address: "UQBiBU93tYPlTDX56vH6uijzHw3ijgaKCaR4aVwH0pnntoLF", index: 6 },
  { name: "Den3", address: "UQA8uBHC92bjMnICa8WdrrL905R5OBkD__7X86GdTwweNd8P", index: 7 },
  { name: "ONE", address: "UQBWj_9jtZ6Id_hDutwp-vl1XGvt4DSP9--tq69qJX4TBF1a", index: 8 },
  { name: "Doz", address: "UQAhFo1T0sFVXqK0puPS-XKHOsdbl9Ksg9idXqRsijmu1soe", index: 9 },
  { name: "Disco", address: "UQBfyS-Oiw5vmmdToSBZ9P2sh-Rau2YcAuEYD3BMR5E6_ZN-", index: 10 },
  { name: "Mih", address: "UQAlPVUKrM8wmsef5lvZkCMBFObDSsR5RvSfAlsdUnT9rhF0", index: 11 },
  { name: "Vnutri", address: "UQD_wyvs5P-vFVClETT-iOxG_0AUZob4eXqW9eqkdLehp9Id", index: 12 },
  { name: "Zuk", address: "UQDdeVyZGT_W-oN8znwilG9hHiutw0FQHfAt4LyggYXRTBk2", index: 13 }
];

async function run() {
  console.log('Truncating tables...');
  await query('TRUNCATE TABLE tracked_wallets RESTART IDENTITY CASCADE;');
  
  for (const w of oldWallets) {
     await query('INSERT INTO tracked_wallets (name, address, wallet_index) VALUES ($1, $2, $3)', [w.name, w.address, w.index]);
     console.log(`Inserted ${w.name}: ${w.address}`);
  }
  console.log('Done!');
  process.exit(0);
}
run();
