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
    conversation = [];
    messageInput = 'what is your name ?';
    userMessage = 'what is your name ?' ;

    handleMessageChange(event) {
        if (event && event.target) {
            this.messageInput = event.target.value;
            //console.log(this.messageInput);
        }
    }

     handleSendMessage() {
        console.log(this.messageInput);
        if (this.messageInput && this.messageInput.trim() !== '') {
            this.appendMessage('User', this.messageInput);
            this.conversation.push({ role: 'user', text: this.messageInput });
            this.messageInput = '';
 
            //console.log('Going to try make server call'); 
            generateResponse({ messageText: this.conversation[this.conversation.length - 1]?.text })
                .then(result => {
                    this.conversation.push({ role: 'assistant', text: result });
                    this.appendMessage('ChatGPT', result);
                })
                .catch(error => {
                    console.error('Error generating ChatGPT response:', error);
                });
  
        }
    }

    appendMessage(sender, message) {
        const chatContent = this.template.querySelector('.chat-content');
        const messageElement = document.createElement('p');
        messageElement.textContent = `${sender}: ${message}`;
        messageElement.className = sender === 'User' ? 'user-message' : 'bot-message';
        chatContent.appendChild(messageElement);
    }

}
