import { LightningElement, wire } from 'lwc';
import { subscribe, unsubscribe, onError, setDebugFlag, isEmpEnabled } from 'lightning/empApi';
import { getRecord } from 'lightning/uiRecordApi';
import { registerListener, unregisterAllListeners } from 'c/pubsub';
import { CurrentPageReference } from 'lightning/navigation';

const CHAT_MESSAGE_EVENT = 'liveAgent:chatMessageEvent';

export default class ChatGPTBotLiveAgent extends LightningElement {
    @wire(CurrentPageReference) pageRef;
    subscription = null;
    chatGPTBotReady = false;

    connectedCallback() {
        console.log('Live agent - Chat Bot 1');
        registerListener(CHAT_MESSAGE_EVENT, this.handleChatMessageEvent, this);
        this.subscribeToChatMessageEvent();
    }

    disconnectedCallback() {
        unregisterAllListeners(this);
        this.unsubscribeFromChatMessageEvent();
    }

    subscribeToChatMessageEvent() {
        if (this.subscription) {
            return;
        }
        subscribe(CHAT_MESSAGE_EVENT, -1, (event) => {
            this.handleChatMessageEvent(event);
        }).then((response) => {
            this.subscription = response;
            this.chatGPTBotReady = true;
        });
    }

    unsubscribeFromChatMessageEvent() {
        if (!this.subscription) {
            return;
        }
        unsubscribe(this.subscription, () => {
            this.subscription = null;
            this.chatGPTBotReady = false;
        });
    }

    async handleChatMessageEvent(event) {
        console.log('Live agent - Chat Bot 2');

        const messageText = event.payload.Message__c;
        const isAgentMessage = event.payload.IsAgentMessage__c;

        console.log('Live agent - Chat Bot 3 - '+messageText);

        if (isAgentMessage && messageText.startsWith('/gpt')) {
            const prompt = messageText.substring(4).trim();
            const chatGPTBotComponent = this.template.querySelector('c-chat-g-p-t-bot');
            const chatGPTResponse = await chatGPTBotComponent.generateChatGPTResponse(prompt);
            // Use the chatGPTResponse and send it via the Live Agent API
            console.log(chatGPTResponse); // For testing purposes
        }
    }
}
