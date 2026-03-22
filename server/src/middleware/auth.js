const jwt = require('jsonwebtoken');
const User = require('../models/User');

/**
 * Middleware: verify JWT from Authorization: Bearer <token>
 * Attaches req.user = { id, username } on success
 */
const protect = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'No token provided. Please log in.' });
    }

    const token = authHeader.split(' ')[1];

    let decoded;
    try {
      decoded = jwt.verify(token, process.env.JWT_SECRET);
    } catch (err) {
      if (err.name === 'TokenExpiredError') {
        return res.status(401).json({ error: 'Token expired. Please log in again.' });
      }
      return res.status(401).json({ error: 'Invalid token. Please log in.' });
    }

    // Attach user info (no DB query needed — trust the JWT payload)
    req.user = { id: decoded.id, username: decoded.username };
    next();
  } catch (error) {
    console.error('[protect middleware]', error);
    res.status(500).json({ error: 'Authentication error' });
  }
};

module.exports = { protect };
