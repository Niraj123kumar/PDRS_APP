const speakeasy = require('speakeasy');
const secret = 'PMZSUSJFHZISQYSUKZFFQPDRGNHG2T3UKZCS4QDXMYSCSI2XOVSQ';
const token = speakeasy.totp({
    secret: secret,
    encoding: 'base32'
});
console.log(token);
