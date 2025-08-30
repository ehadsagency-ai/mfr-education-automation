import { beforeAll, afterAll, afterEach } from 'vitest'
import { MongoMemoryServer } from 'mongodb-memory-server'
import { MongoClient } from 'mongodb'

let mongoServer: MongoMemoryServer
let mongoClient: MongoClient

beforeAll(async () => {
  // Démarrer MongoDB en mémoire pour les tests
  mongoServer = await MongoMemoryServer.create()
  const uri = mongoServer.getUri()
  
  mongoClient = new MongoClient(uri)
  await mongoClient.connect()
  
  // Variables d'environnement pour les tests
  process.env.NODE_ENV = 'test'
  process.env.MONGODB_URI = uri
  process.env.CLAUDE_API_KEY = 'test-key'
  process.env.OPENAI_API_KEY = 'test-key'
  process.env.JWT_SECRET = 'test-jwt-secret'
  process.env.ENCRYPTION_KEY = 'test-encryption-key-32-chars-long'
})

afterAll(async () => {
  if (mongoClient) {
    await mongoClient.close()
  }
  if (mongoServer) {
    await mongoServer.stop()
  }
})

afterEach(async () => {
  // Nettoyer la base de données après chaque test
  if (mongoClient) {
    const collections = await mongoClient.db().collections()
    for (const collection of collections) {
      await collection.deleteMany({})
    }
  }
})