--- send_notification

{
  "type": "object",
  "properties": {
    "eventType": {
      "type": "string",
      "description": "Short event key for logging/categorization, e.g. \"ai.reminder\"."
    },
    "channels": {
      "type": "array",
      "items": {
        "type": "string",
        "enum": [
          "email",
          "slack"
        ]
      },
      "description": "Delivery channels — one or both of \"email\", \"slack\"."
    },
    "recipient": {
      "type": "object",
      "description": "An internal Nexus person (type=person, personId) or a Slack channel (type=channel, channelId).",
      "properties": {
        "type": {
          "type": "string",
          "enum": [
            "person",
            "channel"
          ]
        },
        "personId": {
          "type": "string",
          "description": "Required when type=person."
        },
        "channelId": {
          "type": "string",
          "description": "Required when type=channel."
        }
      },
      "required": [
        "type"
      ]
    },
    "subject": {
      "type": "string",
      "description": "Subject line (used for email)."
    },
    "body": {
      "type": "string",
      "description": "Plain-text message body."
    }
  },
  "required": [
    "eventType",
    "channels",
    "recipient",
    "body"
  ]
}

--- 