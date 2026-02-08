const PORT = Number(process.env.PORT || 3000);
const DEFAULT_BASE_URL = process.env.LM_STUDIO_BASE_URL || "http://localhost:1234/v1";

module.exports = {
  PORT,
  DEFAULT_BASE_URL
};
