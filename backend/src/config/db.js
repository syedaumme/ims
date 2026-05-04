const mongoose = require('mongoose');
const logger = require('../utils/logger');

async function connectMongo() {
  const uri = process.env.MONGODB_URI || 'mongodb://localhost:27017/ims';
  await mongoose.connect(uri, {
    serverSelectionTimeoutMS: 10000,
  });
  logger.info('MongoDB connected');
}

module.exports = { connectMongo };
