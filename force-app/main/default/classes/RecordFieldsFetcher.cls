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
 * @description   This class is used to fetch all non-blank fields of a record and ask chat GPT to summarize.
 */

 public with sharing class RecordFieldsFetcher {

    //Exclude system fields
    private static List<String> excludedFields = new List<String>{
        'Id'.toUpperCase(), 'isDeleted'.toUpperCase(),'ContactId'.toUpperCase(),'CurrencyIsoCode'.toUpperCase(),
        'CreatedById'.toUpperCase(),'LastModifiedById'.toUpperCase(),'AccountId'.toUpperCase(),'OwnerId'.toUpperCase(),
        'BusinessHoursId'.toUpperCase(),'RecordTypeId'.toUpperCase(),'SystemModstamp'.toUpperCase(),'LastActivityDate'.toUpperCase()
    };

    //Consider only these child relationships
    private static List<String> childRelationships = new List<String>{
        'CaseComments' 
    };

    /**
     *  Returns the list of non-blank field names and values for the given record to LWC component.
     */
    @AuraEnabled(cacheable=true)
    public static String getNonBlankFields(String recordId) {
        if (String.isEmpty(recordId)) {
            return 'Record Id is required.';
        }

        Id objectId = Id.valueOf(recordId);
        String objectName = objectId.getSObjectType().getDescribe().getName();

        List<String> fieldNames = getFieldNames(objectName);

        String query = 'SELECT ' + String.join(fieldNames, ',');
        for (String relationship : childRelationships) {
            String childObjectName = getChildObjectName(relationship, objectName);
            List<String> childFieldNames = getFieldNames(childObjectName);
            query += ', (SELECT ' + String.join(childFieldNames, ',') + ' FROM ' + relationship + ')';
        }
        query += ' FROM ' + objectName + ' WHERE Id = :objectId';

        SObject record = Database.query(query);

        List<String> nonBlankFieldList = getNonBlankFieldList(record, objectName);

        for (String relationship : childRelationships) {
            List<SObject> childRecords = (List<SObject>)record.getSObjects(relationship);
            if (childRecords != null) {
                for (SObject childRecord : childRecords) {
                    String childObjectName = childRecord.getSObjectType().getDescribe().getName();
                    nonBlankFieldList.addAll(getNonBlankFieldList(childRecord, childObjectName));
                }
            }
        }

        String promptPrefix = 'This is the information about a service ticket I have, Can you confirm how the client emotion is & what do you make sense of this ? '+
                    'Give a confident answer and dont mention its difficult to determine. If you cant determine emotion then just summarize what you understood. -';
        String prompt = promptPrefix + String.join(nonBlankFieldList, ', '); 
        return ChatGPTService.generateResponse(prompt);
    }

    /**
     * Returns the list of field names for the given object.
     */
    private static List<String> getFieldNames(String objectName) {
        Map<String, Schema.SObjectField> fieldMap = Schema.getGlobalDescribe().get(objectName).getDescribe().fields.getMap();
        List<String> fieldNames = new List<String>();

        for (String fieldName : fieldMap.keySet()) {
            if (!fieldMap.get(fieldName).getDescribe().isCalculated() && !excludedFields.contains(fieldName.toUpperCase())) {
                fieldNames.add(fieldName);
            }
        }

        return fieldNames;
    }

    /**
     * Returns the child object name for the given relationship name.
     */
    private static String getChildObjectName(String relationshipName, String parentObjectName) {
        Schema.SObjectType parentObjectType = Schema.getGlobalDescribe().get(parentObjectName);
        Schema.ChildRelationship childRelation = null;
        for (Schema.ChildRelationship relation : parentObjectType.getDescribe().getChildRelationships()) {
            if (relation.getRelationshipName() == relationshipName) {
                childRelation = relation;
                break;
            }
        }
        if (childRelation != null) {
            return childRelation.getChildSObject().getDescribe().getName();
        } else {
            return null;
        }
    }

    /**
     * Returns the list of non-blank field names and values for the given record.
     */
    private static List<String> getNonBlankFieldList(SObject record, String objectName) {
        Map<String, Schema.SObjectField> fieldMap = Schema.getGlobalDescribe().get(objectName).getDescribe().fields.getMap();
        List<String> nonBlankFieldList = new List<String>();
    
        for (String fieldName : fieldMap.keySet()) {
            try {
                Object fieldValue = record.get(fieldName);
                if (fieldValue != null && String.valueOf(fieldValue).trim() != '') {
                    String fieldLabel = fieldMap.get(fieldName).getDescribe().getLabel();
                    nonBlankFieldList.add(fieldLabel + ': ' + fieldValue);
                }
            } catch (System.SObjectException e) {
                // Field not available in the result, skip and proceed
            }
        }
    
        return nonBlankFieldList;
    }
    
}

 