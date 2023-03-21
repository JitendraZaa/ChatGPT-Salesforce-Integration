/*
 * Copyright  2023 , Author - Jitendra Zaa
 * 
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 * 
 *        https://www.apache.org/licenses/LICENSE-2.0
 * 
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 * 
 *         https://wwww.jitendraZaa.com
 * 
 * @date          March 2023
 * @author        Jitendra Zaa
 * @email         jitendra.zaa+30@gmail.com
 * @description   Apex class to interact with chat GPT Web Service
 */ 
public with sharing class ChatGPTService {
    private static final String API_KEY = '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'; // Replace with your actual API key
    private static final String ENDPOINT_URL = 'https://api.openai.com/v1/engines/davinci-codex/completions';

    @AuraEnabled(cacheable=false)
    public static String generateResponse(String messageText) {
        HttpRequest req = new HttpRequest();
        req.setEndpoint(ENDPOINT_URL);
        req.setMethod('POST');
        req.setHeader('Content-Type', 'application/json');
        req.setHeader('Authorization', 'Bearer ' + API_KEY); // Add the API key to the request header

        // Set the request body
        String prompt = 'You are a helpful assistant.\nUser: ' + messageText + '\nAssistant:';
        System.debug(prompt); 

        Map<String, Object> requestBody = new Map<String, Object>();
        requestBody.put('prompt', prompt);
        requestBody.put('max_tokens', 50);
        requestBody.put('n', 1);
        requestBody.put('stop', new List<String>{'\n'});

        req.setBody(JSON.serialize(requestBody));

        Http http = new Http();
        HttpResponse res = http.send(req);

        if (res.getStatusCode() == 200) {
            System.debug(res.getBody());
            Map<String, Object> responseBody = (Map<String, Object>)JSON.deserializeUntyped(res.getBody());
            List<Object> choices = (List<Object>)responseBody.get('choices');
            if (choices.size() > 0) {
                Map<String, Object> choice = (Map<String, Object>)choices.get(0);
                String responseText = (String)choice.get('text');
                responseText = responseText != null ? responseText.trim() : '';
                return responseText;
            }
        } else {
            System.debug('Error: ' + res.getStatusCode() + ' ' + res.getStatus());
            throw new ChatGPTException('Error: Unable to generate response from ChatGPT.');
        }

        return '';
    }

    public class ChatGPTException extends Exception {}
} 