/*
 * Copyright  2023 IBM, Author - Jitendra Zaa
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
 * @date          April 2023
 * @author        Jitendra Zaa
 * @email         jitendra.zaa@ibm.com | jitendra.zaa+30@gmail.com
 * @description   This LWC component is used to fetch non-blank fields of a record.
 */
import { LightningElement, api, track } from 'lwc';
import getNonBlankFields from '@salesforce/apex/RecordFieldsFetcher.getNonBlankFields';

export default class ChatGPTIntelligence extends LightningElement {
    @api recordId;
    @track nonBlankFields;
    @track nonBlankFieldsFormatted;
    @track isLoading = true;

    // first method to get executed when LWC component is loaded
    connectedCallback() {
        this.fetchNonBlankFields();
    }

    // Fetch non-blank fields of a record
    fetchNonBlankFields() {
        this.isLoading = true;
        getNonBlankFields({ recordId: this.recordId })
            .then((result) => {
                this.nonBlankFields = result;
                this.nonBlankFieldsFormatted = this.formatFields(result);
                this.isLoading = false;
            })
            .catch((error) => {
                console.error('Error fetching non-blank fields:', error);
                this.isLoading = false;
            });
    }

    // reusable method to format outcome of getNonBlankFields() method from apex controller
    formatFields(fieldsText) {
        const emailRegex = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
        const nonEmailParts = fieldsText.split(emailRegex);
        const emails = [...fieldsText.matchAll(emailRegex)].map(match => match[0]);
    
        let formattedParts = [];
        for (let i = 0; i < nonEmailParts.length; i++) {
            const nonEmailPart = nonEmailParts[i];
            const nonEmailFragments = nonEmailPart.split('.');
            nonEmailFragments.forEach((fragment, index) => {
                if (index < nonEmailFragments.length - 1) {
                    formattedParts.push({ id: formattedParts.length, text: fragment.trim() + '.' });
                } else {
                    formattedParts.push({ id: formattedParts.length, text: fragment.trim() });
                    if (i < emails.length) {
                        const nextPart = nonEmailParts[i + 1];
                        const emailWithDot = nextPart && nextPart.startsWith(' ') ? emails[i] + '.' : emails[i];
                        formattedParts.push({ id: formattedParts.length, text: emailWithDot });
                    }
                }
            });
        }
    
        return formattedParts;
    }
    
    
    
}
