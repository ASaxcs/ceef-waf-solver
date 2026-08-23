const Ajv = require("ajv")
const addFormats = require("ajv-formats")

const ajv = new Ajv()
addFormats(ajv)

const schema = {
    "type": "object",
    "properties": {
        "mode": {
            "type": "string",
            "enum": ["source", "turnstile-min", "turnstile-max", "waf-session", "auto", "pinjam-ip", "ip-bound"],
        },
        "proxy": {
            "type": "object",
            "properties": {
                "host": { "type": "string" },
                "port": { "type": "integer" },
                "username": { "type": "string" },
                "password": { "type": "string" }
            },
            "additionalProperties": false
        },
        "url": {
            "type": "string",
            "format": "uri",
        },
        "authToken": {
            "type": "string"
        },
        "siteKey": {
            "type": "string"
        },
        "method": {
            "type": "string"
        },
        "postData": {
            "type": ["object", "string"]
        },
        "customHeaders": {
            "type": "object"
        }
    },
    "required": ["mode", "url"],
    "additionalProperties": false
}

function validate(data) {
    const valid = ajv.validate(schema, data)
    if (!valid) return ajv.errors
    else return true
}

module.exports = validate