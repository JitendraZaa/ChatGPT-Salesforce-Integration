# chatGPT Integration with Salesforce

## Initial Setup
1. Update custom label `ChatGPTAPIKey` with [your openAI API key](https://platform.openai.com/account/api-keys).
2. To use chat, add LWC `ChatGPTBot` on your lightning page.
3. To detect sentiment of customer for support ticket, add LWC `chatGPTIntelligence` on case record page. If you want to fetch any child record then update variable `childRelationships` in `RecordFieldsFetcher` class. 

## Youtube video on how to use it 

[![chatGPT Integration with Salesforce by Jitendra Zaa](https://img.youtube.com/vi/cdWAh2okH-w/0.jpg)](https://www.youtube.com/watch?v=cdWAh2okH-w "chatGPT Integration with Salesforce by Jitendra Zaa")

## Resources
1. [postman chatGPT collection](https://quickstarts.postman.com/guide/chatgpt/index.html?index=..%2F..index)
  
## Test Anonynous Code

```
String prompt = 'Till what date latest information your model has ?';
String outcome = ChatGPTService.generateResponse(prompt);
System.debug(outcome);
```

## Known Limitations
1. Whole history of conversation not sent. Code can be modified to send whole history of conversation for better experience.
