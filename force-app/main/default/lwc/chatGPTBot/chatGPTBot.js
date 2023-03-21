/*
 * Copyright  2023  , Author - Jitendra Zaa
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
 * @email           jitendra.zaa+30@gmail.com
 * @description   TBD
 */ 
import { LightningElement, track } from 'lwc';
import generateResponse from '@salesforce/apex/ChatGPTService.generateResponse';

export default class ChatGPTBot extends LightningElement {
    @track conversation = [];
    @track messageInput = '';

    handleChange(event) {
        if (event && event.target) {
            this.messageInput = event.target.value;
        }
    }

    async handleSendMessage() {
        if (this.messageInput && this.messageInput.trim() !== '') {
            const userMessage = {
                id: 'user-' + this.conversation.length,
                role: 'user',
                text: this.messageInput,
                containerClass: 'slds-chat-message slds-chat-message_outbound user-message',
                textClass: 'slds-chat-message__text slds-chat-message__text_outbound',
                isBot : false
            };
            this.conversation = [...this.conversation, userMessage];
            this.messageInput = '';

            try {
                const chatGPTResponse = await generateResponse({ messageText: this.conversation[this.conversation.length - 1]?.text });
                if (chatGPTResponse && chatGPTResponse.trim() !== '') {
                    const assistantMessage = {
                        id: 'assistant-' + this.conversation.length,
                        role: 'assistant',
                        text: chatGPTResponse,
                        containerClass: 'slds-chat-message slds-chat-message_inbound',
                        textClass: 'slds-chat-message__text slds-chat-message__text_inbound',
                        isBot : true
                    };
                    this.conversation = [...this.conversation, assistantMessage];
                } else {
                    console.error('Error generating ChatGPT response: Empty response');
                }
            } catch (error) {
                console.error('Error generating ChatGPT response:', error);
            }
        }
    }
}
