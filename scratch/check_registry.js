const { Address } = require('@ton/core');

const registry = [
  { name: 'Alex1', addr: 'UQDq8mAR0vaK1iHEq_1UuLoXmPLwZ5nUdjM_GTRX87YZdnhp' },
  { name: 'Alex2', addr: 'UQDNItVDUjs9tefv7xdrqgw44jwzF7xzoEI11fQXCJGorojeE' },
  { name: 'Alex3', addr: 'UQA_MxFfYpkF0yXSyugYme5pZQEre92BOgxELUonYAl6nXEn' },
  { name: 'Alex4', addr: 'UQDQ30x50nf3ahz7Olj2xxBXV_b3_364DXyqyEPsxTKCDVal' },
  { name: 'Den1',  addr: 'UQDSG8EPkjDOTMtNPcv3FMZfkmT1VmFq_nHGBsfqgF932xDf' },
  { name: 'Den2',  addr: 'UQBiBU93tYPITDX56vH6uijzHw3ijgaKCaR4aVwH0pnntoLF' },
  { name: 'Den3',  addr: 'UQA8uBHC92bjMnICa8WdrrL905R5OBkD__7X86GdTwwENd8P' },
  { name: 'ONE',   addr: 'UQBWj_9jtZ6Id_hDutwp-vl1XGvt4DSP9--tq69qJX4TBF1a' },
  { name: 'Doz',   addr: 'UQAhFo1T0sFVXqK0puPS-XKHOsdbl9Ksg9idXqRsijmu1soe' },
  { name: 'Disco', addr: 'UQBfyS-Oiw5vmmdToSBZ9P2sh-Rau2YcAuEYD3BMR5E6_ZN-' },
  { name: 'Mih',   addr: 'UQAIPVUKrM8wmsef5lvZkCMBFObDSsR5RvSfAls dUnT9rhF0' },
  { name: 'Vnutri',addr: 'UQD_wyvs5P-vFVCIETT-iOxG_0AUZob4eXqW9eqkdLehp9Id' },
  { name: 'Zuk',   addr: 'UQDdeVyZGT_W-oN8znwilG9hHiutw0FQHfAt4LyggYXRTBk2' }
];

console.log('--- VALIDATION RESULTS ---');
for (const w of registry) {
  try {
    Address.parse(w.addr.trim());
    console.log(`✅ ${w.name}: OK`);
  } catch (err) {
    console.log(`❌ ${w.name}: INVALID ADDRESS (${w.addr})`);
    console.log(`   Reason: ${err.message}`);
  }
}
