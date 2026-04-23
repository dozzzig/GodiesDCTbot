import asyncio
from database import db

async def run_fix():
    await db.connect()
    async with db.pool.acquire() as conn:
        print("Dropping old constraint...")
        await conn.execute("ALTER TABLE transactions DROP CONSTRAINT IF EXISTS transactions_currency_check;")
        print("Adding new constraint...")
        await conn.execute("ALTER TABLE transactions ADD CONSTRAINT transactions_currency_check CHECK (currency IN ('STARS', 'USDT', 'TON', 'RUB'));")
        print("Done!")
    await db.disconnect()

if __name__ == "__main__":
    asyncio.run(run_fix())
