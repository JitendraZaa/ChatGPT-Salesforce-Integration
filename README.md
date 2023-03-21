# Salesforce chat integration with ChatGPT


## Notes
1. Org 29 has chat bot enabled. Community Link - https://jit29-dev-ed.my.site.com/UrsaMajor/s/
1. Presence status - `Available - Chat` 
1. Get API key from https://api.openai.com 
1. Copy SF Console Integration toolkit from URL `/support/console/57.0/integration.js`
1. Customize Prechat form to trasnfer JSON to main chat page - `https://developer.salesforce.com/docs/component-library/bundle/lightningsnapin-base-prechat/documentation`
1. LWC should have target as `lightningSnapin__PreChat` so that it can appear as pre chat form.


## Idea 
1. Add chatbot on public page and see how it works

## Limitations
1. Whole history of conversation not sent. Code can be modified to send whole history of conversation for better experience.

## Test Anonynous Code

```
String prompt = 'Till what date latest information your model has ?';
String outcome = ChatGPTService.generateResponse(prompt);
System.debug(outcome);
```
