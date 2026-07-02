import { buildApp } from './app.js'
import { openDb, seed } from './db.js'

const dbPath = process.env.PETSHOP_DB ?? 'data/petshop.db'
const port = Number(process.env.PORT ?? 4000)

const db = openDb(dbPath)
seed(db)

const app = buildApp(db)
app
  .listen({ port, host: '0.0.0.0' })
  .then(() => console.log(`petshop api on :${port} (db: ${dbPath})`))
  .catch((err) => {
    console.error(err)
    process.exit(1)
  })
