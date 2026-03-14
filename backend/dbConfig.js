require('dotenv').config();

module.exports = {
	db_url: process.env.DB_URL,
	JWT_SECRET: process.env.JWT_SECRET,
};
