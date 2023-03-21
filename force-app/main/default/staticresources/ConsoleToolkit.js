/*
 * Copyright 2017 salesforce.com, inc.
 * All Rights Reserved
 * Company Confidential
 */

window.sforce = window.sforce || {};

sforce.console = (function() {
    var VERSION = '57.0';
    var CALLEE_NAME = 'sfdc-console';
    var txn_id = 0;
    var ON_CALL_END = 'onCallEnd';
    var ADD_EVENT_LISTENER = 'addEventListener';
    var ADD_PUSH_NOTIFICATION_LISTENER = 'addPushNotificationListener';
    var caller;
    var registry;

    /**
     * A class representing a generic registry for storing event and regular function callbacks
     */
    var Registry = function() {
        this.registry = {};
    };

    // Returns the name of the frame that is one level below window.top (console).
    // The post message should always come from this iframe or else console's API handler
    // does not know what frame to target
    function getOriginFrameName() {
        var targetWindowName = '';
        var targetWindow = window;

        do {
            try {
                targetWindowName = targetWindow.name;
                targetWindow = targetWindow.parent;
            } catch (e) {
                // most likely an access error due to same-origin policy
                break;
            }
        } while (targetWindow !== window.top);

        return targetWindowName;
    }

    Registry.prototype.registerFunction = function(funcName, func, scope) {
        this.registry[funcName] = {func : func, scope : scope};
    };

    Registry.prototype.getFunction = function(funcName) {
        return this.registry[funcName];
    };

    Registry.prototype.removeFunction = function(funcName) {
        delete this.registry[funcName];
    };

    var canvasClient = (function() {
        var parsedRequest = null;

        return {
            isCanvasContext : function() {
                return !!(typeof Sfdc !== 'undefined' && Sfdc.canvas && Sfdc.canvas.client);
            },

            getParsedRequest : function() {
                if (!parsedRequest) {
                    var signedRequest = Sfdc.canvas.client.signedrequest();
                    if (signedRequest) {
                        if (typeof signedRequest === "string") {
                            try {
                                parsedRequest = JSON.parse(signedRequest);
                            } catch (e) {
                                return null;
                            }
                        } else {
                            // assume we're using OAuth
                            parsedRequest = signedRequest;
                        }
                    }
                }
                return parsedRequest;
            },

            parseAuthenticationParams : function (postMessageClient) {
                // if sfdc frame origin or nonce is missing and context is a canvas app,
                // try to parse params from canvas signedrequest
                if (this.isCanvasContext()) {
                    parsedRequest = this.getParsedRequest();

                    if (parsedRequest) {
                        var environment;
                        if (parsedRequest.context) {
                            environment = parsedRequest.context.environment;
                        } else if (parsedRequest.payload) {
                            environment = parsedRequest.payload.environment;
                        }
                        if (environment && environment.parameters) {
                            postMessageClient.sfdcIFrameOrigin = environment.parameters.sfdcIframeOrigin;
                            postMessageClient.nonce = environment.parameters.nonce;
                        }
                    }
                }
            },

            // this is called from isInConsole API
            // need to make sure canvas is enabled and JSON is available because isInConsole
            // can be called from standard app with older browsers (IE7)
            isInConsole : function () {
                if (this.isCanvasContext()) {
                    parsedRequest = this.getParsedRequest();

                    if (parsedRequest) {
                        var environment = parsedRequest.context.environment;
                        if (environment && environment.parameters.isInConsole) {
                            return true;
                        }
                    }
                }
                return false;
            }
        };
    })();

    var postMessageClient = {
        nonce : null,
        sfdcIFrameOrigin : null,
        INTEGRATION_API : 'integrationApi/',

        usePostMessage : function () {
            if (window.postMessage && this.sfdcIFrameOrigin && this.nonce) {
                return true;
            }

            this.parseAuthenticationParams();

            return !!(window.postMessage && this.sfdcIFrameOrigin && this.nonce);
        },

        parseAuthenticationParams : function () {
            // parse SFDC frame origin and nonce needed by API calls
            var params = this.parseUrlQueryString(location.search);

            if (params.sfdcIFrameOrigin) {
                this.sfdcIFrameOrigin = params.sfdcIFrameOrigin.toLowerCase();
            } else if (params.sfdcIframeOrigin) {
                this.sfdcIFrameOrigin = params.sfdcIframeOrigin.toLowerCase();
            }

            this.nonce = params.nonce;

            if (!(this.sfdcIFrameOrigin && this.nonce)) {
                canvasClient.parseAuthenticationParams(this);
            }
        },

        initialize : function() {
            if (window.attachEvent) {
                window.attachEvent('onmessage', this.processPostMessage);
            } else {
                window.addEventListener('message', this.processPostMessage, false);
            }
        },

        registry : new Registry(),

        parser : (function() {
            var BOOLEAN_TYPE = 'b';
            var STRING_TYPE = 's';
            var ARRAY_TYPE = 'a';
            var ARG_DELIM = '&';
            var ARRAY_DELIM = ';';
            var TYPE_DELIM = ':';
            var VAL_DELIM = '=';

            function isArray(a) {
                return Object.prototype.toString.apply(a) === '[object Array]';
            }

            function flattenArray(arr) {
                var arr_delim = '';
                var arr_str = '';
                for (var i = 0; i < arr.length; i++) {
                    arr_str += arr_delim + encodeURIComponent(arr[i]);
                    arr_delim = ARRAY_DELIM;
                }
                return arr_str;
            }

            return {
                parse:function(message) {
                    var query = {};
                    var parts = message.split(ARG_DELIM);

                    for(var i = 0; i < parts.length; i++) {
                        var pair = parts[i].split(VAL_DELIM);
                        var value = pair[1].split(TYPE_DELIM);
                        var parsedValue;
                        if (value[0] === ARRAY_TYPE) {
                            var arr = value[1].split(ARRAY_DELIM);
                            parsedValue = [];
                            for(var j = 0; j < arr.length; j++) {
                                parsedValue[j] = decodeURIComponent(arr[j]);
                            }
                        } else {
                            parsedValue = decodeURIComponent(value[1]);
                        }
                        if (value[0] === BOOLEAN_TYPE) {
                            parsedValue = parsedValue === 'true';
                        }
                        query[decodeURIComponent(pair[0])] = parsedValue;
                    }
                    return query;
                },
                stringify:function(obj) {
                    var delim = '';
                    var str = '';
                    for (var key in obj) {
                        if (obj.hasOwnProperty(key)) {
                              var type;
                              if (isArray(obj[key])) {
                                str += delim + encodeURIComponent(key) + VAL_DELIM + ARRAY_TYPE + TYPE_DELIM + flattenArray(obj[key]);
                              } else {
                                type = typeof(obj[key]) === 'boolean' ? BOOLEAN_TYPE : STRING_TYPE;
                                str += delim + encodeURIComponent(key) + VAL_DELIM  + type  + TYPE_DELIM + encodeURIComponent(obj[key]);
                             }

                              delim = ARG_DELIM;
                        }
                    }
                    return str;
                }
            };
        })(),

        /**
         * send message to sfdc client side using HTML5 postMessages
         */
        doPostMessage: function(event) {
            var id = event.calleeName + '_' +  'proxyFrame' + '_' + event.txn_id;

            var argsContext = {};
            if (typeof(event.name) !== 'undefined') { argsContext.xdomain_name = event.name; }
            if (typeof(event.calleeName) !== 'undefined') { argsContext.xdomain_targetFrame = event.calleeName; }
            if (typeof(event.txn_id) !== 'undefined') { argsContext.xdomain_txnId = event.txn_id; }
            if (typeof(event.pathToOriginProxy) !== 'undefined') { argsContext.xdomain_pathToOriginProxy = event.pathToOriginProxy; }
            if (typeof(event.targetParentFrame) !== 'undefined') { argsContext.xdomain_targetParentFrame = event.targetParentFrame; }

            argsContext.xdomain_originFrame = getOriginFrameName();
            argsContext.nonce = this.nonce;

            var message = this.parser.stringify(argsContext);
            if (typeof(event.args) !== 'undefined') {
                message += '&' +  this.parser.stringify(event.args);
            }

            top.postMessage(this.INTEGRATION_API + message, this.sfdcIFrameOrigin);
        },

        /**
         * Receives message from sfdc and executes callback
         */
        processPostMessage: function(event) {
            var xdomainArgs = {};
            var targetParentFrame;
            var callRegistry;
            var result;

            if (event.origin !== postMessageClient.sfdcIFrameOrigin) {
                // Only trust messages coming from SFDC origin
                return;
            }

            if (event.data) {
                if (typeof event.data !== 'string' || event.data.indexOf(postMessageClient.INTEGRATION_API) !== 0) {
                    return;
                }
            } else {
                return;
            }

            // strip off API target
            var message = event.data.replace(postMessageClient.INTEGRATION_API, '');

            // parse message received from sfdc
            result = postMessageClient.parser.parse(message);
            result.args = postMessageClient.parser.parse(result.args);

            callRegistry = registry.getFunction(result.name);
            xdomainArgs.frameId = result.originFrame;

            if (typeof(callRegistry) !== 'undefined') {
                callRegistry.func.call(callRegistry.scope, result.args, xdomainArgs);
            }
        },

        /**
         * Utility method to create a query string object.
         */
        parseUrlQueryString: function(queryString) {
            var params = {};
            if (typeof queryString !== 'string') {
                return params;
            }

            if (queryString.charAt(0) === '?') {
                queryString = queryString.slice(1);
            }

            if (queryString.length === 0) {
                return params;
            }

            var pairs = queryString.split('&');
            for (var i = 0; i < pairs.length; i++) {
                var pair = pairs[i].split('=');
                params[pair[0]] = !!pair[1] ? decodeURIComponent(pair[1]) : null;
            }

            return params;
        }
    };

    /**
     * Returns true if the current page is a Salesforce native page, i.e. the page is served from the same origin as the console main page
     */
    function isSalesforceNativePage() {
        var accessible = null;
        try {
            accessible = top.location.href;
        } catch (e) {}
        return (typeof accessible === 'string') && top.isServiceDeskPage;
    }

    /**
     * Initialize cross domain communication using iframe proxy or HTML5 PostMessage.
     * If browser supports PostMessage, use this approach.
     * Else use iframe proxy approach.
     */
    if (isSalesforceNativePage()) {
        // create a registry for tab event listeners
        registry = new Registry();
    } else if (postMessageClient.usePostMessage()) {
        // use postMessage framework
        registry = postMessageClient.registry;
        postMessageClient.initialize();
    } else if (window.Sfdc && Sfdc.xdomain) {
        // use iframe proxy
        caller = Sfdc.xdomain.Caller;
        registry = Sfdc.xdomain.CrossDomainApiRegistry;
    } else {
        if (window.console && console.log) {
            console.log('Service Cloud Toolkit API cannot be used with your browser.');
        }
    }

    /**
     * Wrap a callback to remove the callback from the registry and execute the callback
     */
    function wrapCallback(fname, callback, args) {
        if (args.event) {
            var handlers, ConstructorFn;
            var isGlobalEvent = fname === ADD_EVENT_LISTENER;
            var isLiveAgentChatEvent = (fname === "chatOnNewMessage" || fname === "chatOnTypingUpdate"
                || fname === "chatOnCustomEvent" || fname === "chatOnCriticalWaitState"
                || fname === "chatOnAgentSend" || fname === "chatOnFileTransferCompleted");
            if (fname === ON_CALL_END) {
                // special CTI event handlers
                // if call object id is provided associate event handler with it, otherwise event handler is called for all call object ids
                handlers = [{fn:callback, id:args.callObjectId}];
            } else if (isGlobalEvent) {
                // global event handlers
                handlers = {};
                handlers[args.eventType] = [callback];
            } else if (isLiveAgentChatEvent) {
                handlers = {};
                //Some Live Agent events are sent for specific chats, or even specific chats on specific eventTypes. The code in here
                // assumes that fname is the only unique identifier for events. We need to handle things differently for Live Agent. If
                // the event is one of the Live Agent events specific to a chat, we take an eventId that contains the rest of the uniqueness
                // and use that as the identifier.
                handlers[fname+args.eventId] = [callback];
            } else {
                // standard event handlers
                handlers = [callback];
            }

            ConstructorFn = function() {
                // add an event handler, return true if the event type already exists, false otherwise
                // for standard event types, it always return true
                this.add = function(eventHandler, args) {
                    var isExistingEventType = true;
                    if (fname === ON_CALL_END) {
                        handlers.push({fn:eventHandler, id:args.callObjectId});
                    } else if (isGlobalEvent) {
                        if (!handlers[args.eventType]) {
                            isExistingEventType = false;
                            handlers[args.eventType] = [];
                        }
                        handlers[args.eventType].push(eventHandler);
                    } else if (isLiveAgentChatEvent) {
                        if (!handlers[fname+args.eventId]) {
                            isExistingEventType = false;
                            handlers[fname+args.eventId] = [];
                        }
                        handlers[fname+args.eventId].push(eventHandler);
                    } else {
                        handlers.push(eventHandler);
                    }
                    return isExistingEventType;
                };

                // delete an event handler, return true if cross-domain clean-up is needed, false otherwise
                this.del = function(eventHandler, args) {
                    if (isGlobalEvent) {
                        var handlerFns = handlers[args.eventType];
                        var cleanUpOptions = {unregisterFrameForEvent : false, unregisterFrameForEveryEvent : false};

                        if (!handlerFns) {
                            return cleanUpOptions;
                        }

                        for (var i = 0; i < handlerFns.length; i++) {
                            if (handlerFns[i] === eventHandler) {
                                handlerFns.splice(i, 1);
                                break;
                            }
                        }

                        if (handlerFns.length === 0) {
                            // this frame no longer has handlers for this event type
                            cleanUpOptions.unregisterFrameForEvent = true;
                        }

                        for (var eventType in handlers) {
                            if (handlers.hasOwnProperty(eventType)) {
                                if (handlers[eventType].length > 0) {
                                    return cleanUpOptions;
                                }
                            }
                        }

                        // this frame no longer has handlers for any global event
                        cleanUpOptions.unregisterFrameForEveryEvent = true;
                        registry.removeFunction(ADD_EVENT_LISTENER);
                        return cleanUpOptions;
                    }
                    // implicitly return undefined if it's called upon a non-global event handler
                };

                this.call = function(scope, args, xdomainArgs, callback) {
                    var handlerFns, i;
                    if (isGlobalEvent) {
                        handlerFns = handlers[args.eventType] ? handlers[args.eventType] : [];

                        // no need to pass eventType to the listeners
                        delete args.eventType;
                        for (i = 0; i < handlerFns.length; i++) {
                            handlerFns[i].call(scope, args, xdomainArgs, callback);
                        }
                    } else if (isLiveAgentChatEvent) {
                        handlerFns = handlers[fname+args.eventId] ? handlers[fname+args.eventId] : [];
                        // no need to pass eventId to the listeners
                        delete args.eventId;
                        for (i=0; i < handlerFns.length; i++) {
                            handlerFns[i].call(scope, args, xdomainArgs, callback);
                        }
                    } else {
                        i = 0;
                        while (i<handlers.length) {
                            if (typeof handlers[i].fn === 'function') {

                                // skip if id is null or id not equal to call object id
                                if (!!handlers[i].id && handlers[i].id !== args.id) {
                                    continue;
                                }

                                handlers[i].fn.call(scope, args, xdomainArgs, callback);

                                // remove handler if id equals call object id
                                if (handlers[i].id === args.id) {
                                    handlers.splice(i, 1);
                                    i--;
                                }
                            } else {
                                handlers[i].call(scope, args, xdomainArgs, callback);
                            }
                            i++;
                        }
                    }
                };
            };
            return new ConstructorFn();
        } else {
            return function(args) {
                registry.removeFunction(fname);
                callback.call(this, args);
            };
        }
    }

    function getPathToOriginProxy() {
        var url = window.location.toString();
        var protocolDelim = "://";
        var domainDelims = ["/", "?", "#"];
        var start = url.indexOf(protocolDelim);
        var protocol = "";
        if (-1 !== start) {
            var parts = url.split(protocolDelim);
            protocol = parts[0] + protocolDelim;
            url = parts[1];
            for(var i = 0; i < domainDelims.length; i++) {
                var end = url.indexOf(domainDelims[i]);
                if (-1 !== end) {
                    url = url.substring(0, end);
                    break;
                }
            }
        }
        return protocol + url;
    }

    /**
     * Make a call to the callee domain
     */
    function execute(fname, args, callback) {
        var isExistingEventType;
        if (sforce.console.isCanvasContext()) {
            args._isCanvas = true;
        }

        if (isSalesforceNativePage()) {
            // no need to do cross-domain messaging
            var targetCallRegistry = top.Sfdc.crossdomain.CrossDomainApiRegistry.getFunction(fname),
                embeddedVFPages = top.Sfdc.xdomain.EmbeddedVFPages,
                frameId = window.name,
                logString = '',
                result;

            if (window.parent !== window.top && embeddedVFPages && embeddedVFPages[frameId]) {
                // in an embedded VF page
                frameId = embeddedVFPages[frameId];
            } else if (window.parent !== window.top) {
                // in an internal embedded iframe page that is not visualforce
                // Example: for a framed related list on detail page, this
                // sets the frameId to the detail page's ID
                frameId = window.parent.name;
            }

            // register event callback if needed
            if (typeof(callback) === 'function' && args.event) {
                if (registry.getFunction(fname)) {
                    isExistingEventType = registry.getFunction(fname).func.add(callback, args);
                    if (isExistingEventType) {
                        // since the event type already exists, return right away to avoid an unnecessary x-domain call
                        return {success : true};
                    } // TODO: wrong comment, remove it after verification. for global event, do an x-domain call to update the registry
                } else {
                    registry.registerFunction(fname, wrapCallback(fname, callback, args), this);//TODO: check the scope
                }

                result = targetCallRegistry.func.call(targetCallRegistry.scope, args, {frameId : frameId}, function(result) {
                    registry.getFunction(fname).func.call(this, result); //TODO: check the scope
                });
            } else {
                result = targetCallRegistry.func.call(targetCallRegistry.scope, args, {frameId : frameId}, callback);
            }

            return result;
        } else {
            // register callback if needed
            if (typeof(callback) === 'function') {
                var functionName = args.event ? fname : fname + '_' + txn_id;
                if (args.event && registry.getFunction(functionName)) {
                    isExistingEventType = registry.getFunction(functionName).func.add(callback, args);
                    if (isExistingEventType) {
                        // since the event type already exists, return right away to avoid an unnecessary x-domain call
                        return;
                    } // for global event, do an x-domain call to update the registry
                } else {
                    registry.registerFunction(functionName, wrapCallback(functionName, callback, args), this);
                }
            }
            var callContext = {};
            callContext.pathToTargetProxy = caller ? Sfdc.xdomain.sfdcXDomainProxy : '';
            callContext.name = fname;
            callContext.args = args;
            callContext.calleeName = CALLEE_NAME;
            callContext.txn_id = txn_id;
            callContext.pathToOriginProxy = getPathToOriginProxy() + (caller ? '/support/console/xdomain/30.0/crossDomainProxy.html' : '');
            txn_id++;

            if (postMessageClient.usePostMessage()) {
                postMessageClient.doPostMessage(callContext);
            } else {
                caller.call(callContext);
            }
        }
    }

    /**
     * Encode boolean parameter
     *
     * if true, return string "true"
     * false, return an empty string [represent false value in js]
     */
    function encodeBooleanParam(param) {
        return !!param;
    }

    /**
     * Validate the event type used in Global Event Model. Return true if valid, false otherwise.
     */
    function validateEventType(eventType) {
        return eventType && (typeof eventType === 'string');
    }

    /**
     * Validate the event handler used in Global Event Model. Return true if valid, false otherwise.
     */
    function validateEventHandler(eventHandler) {
        return eventHandler && (typeof eventHandler === 'function');
    }

    /**
     * An object responsible for managing console events and providing helper functions around them
     */
    var ConsoleEventManager = (function() {
        var CONSOLE_EVENT_PREFIX = 'SFORCE_CONSOLE';
        var CONSOLE_EVENT_NAME_SEPERATOR = ':';
        var TAB_EVENT_SUFFIX = '_TAB';
        var PRESENCE_EVENT_PREFIX = 'SFORCE_PRESENCE';

        // Supported event types
        var EVENT_TYPES = {
                CLOSE_TAB : CONSOLE_EVENT_PREFIX + CONSOLE_EVENT_NAME_SEPERATOR + 'CLOSE_TAB',
                OPEN_TAB  : CONSOLE_EVENT_PREFIX + CONSOLE_EVENT_NAME_SEPERATOR + 'OPEN_TAB',
                CONSOLE_LOGOUT : CONSOLE_EVENT_PREFIX + CONSOLE_EVENT_NAME_SEPERATOR + 'LOGOUT',
                PRESENCE : {
                    LOGIN_SUCCESS    : PRESENCE_EVENT_PREFIX + CONSOLE_EVENT_NAME_SEPERATOR + 'LOGIN_SUCCESS',
                    STATUS_CHANGED   : PRESENCE_EVENT_PREFIX + CONSOLE_EVENT_NAME_SEPERATOR + 'STATUS_CHANGED',
                    LOGOUT           : PRESENCE_EVENT_PREFIX + CONSOLE_EVENT_NAME_SEPERATOR + 'LOGOUT',
                    WORK_ASSIGNED    : PRESENCE_EVENT_PREFIX + CONSOLE_EVENT_NAME_SEPERATOR + 'WORK_ASSIGNED',
                    WORK_ACCEPTED    : PRESENCE_EVENT_PREFIX + CONSOLE_EVENT_NAME_SEPERATOR + 'WORK_ACCEPTED',
                    WORK_DECLINED    : PRESENCE_EVENT_PREFIX + CONSOLE_EVENT_NAME_SEPERATOR + 'WORK_DECLINED',
                    WORK_CLOSED      : PRESENCE_EVENT_PREFIX + CONSOLE_EVENT_NAME_SEPERATOR + 'WORK_CLOSED',
                    WORKLOAD_CHANGED : PRESENCE_EVENT_PREFIX + CONSOLE_EVENT_NAME_SEPERATOR + 'WORKLOAD_CHANGED'
                }
        };

        var isTypeEndWith = function(eventType, suffix) {
            if (eventType && suffix) {
                return (eventType.indexOf(suffix) + suffix.length) === eventType.length;
            }

            return false;
        };

        return {
            getTypes : function() {
                return EVENT_TYPES;
            },

            getFullyQualifiedEventType : function(eventType, additionalParams) {
                if (isTypeEndWith(eventType, TAB_EVENT_SUFFIX) && additionalParams && additionalParams.tabId) {
                    // it's a tab event
                    eventType = [eventType, additionalParams.tabId].join(CONSOLE_EVENT_NAME_SEPERATOR);
                }

                return eventType;
            },

            isConsoleEventType : function(eventType) {
                for (var type in EVENT_TYPES) {
                    if (EVENT_TYPES.hasOwnProperty(type) && EVENT_TYPES[type] === eventType) {
                        return true;
                    }
                }

                return false;
            }
        };
    })();

    return {
        /**
         * Create a Workspace with the given url. If the workspace already exists, navigate it to the url.
         * @param version
         * @param id (optional) id of an existing Workspace
         * @param url url of the Workspace
         * @param activate true to make the Workspace activate, false otherwise
         * @param label String text to put into the Workspace tab
         * @param callback (optional) a callback function to be invoked after the function exits.
         */
        openPrimaryTab: function (id, url, activate, label, callback, name) {
            var args = {};
            if (id) { args.id = id; }
            if (typeof(url) !== 'undefined') { args.url = url; }
            if (typeof(activate) !== 'undefined') { args.activate = encodeBooleanParam(activate); }
            if (typeof(label) !== 'undefined') { args.label = label; }
            if (typeof(name) !== 'undefined') { args.name = name; }
            args.version = VERSION;
            execute('openPrimaryTab', args, callback);
        },

        /**
         * Open a subtab
         * @param id (optional) id of an existing view
         * @param workspaceId id of an existing workspace
         * @param url
         * @param activate
         * @param label
         * @param name
         */
        openSubtab:function(workspaceId, url, activate, label, id, callback, name) {
            var args = {};
            if (workspaceId) { args.workspaceId = workspaceId; }
            if (typeof(url) !== 'undefined') { args.url = url; }
            if (typeof(activate) !== 'undefined') { args.activate = encodeBooleanParam(activate); }
            if (typeof(label) !== 'undefined') { args.label = label; }
            if (id) { args.id = id; }
            if (name) { args.name = name; }
            args.version = VERSION;
            execute('openSubTab', args, callback);
        },
        /**
         * Open a subtab
         * @param id (optional) id of an existing view
         * @param workspaceName name of an existing workspace
         * @param url
         * @param activate
         * @param label
         * @param name
         */
        openSubtabByPrimaryTabName:function(workspaceName, url, activate, label, id, callback, name) {
            var args = {};
            if (workspaceName) { args.workspaceName = workspaceName; }
            if (typeof(url) !== 'undefined') { args.url = url; }
            if (typeof(activate) !== 'undefined') { args.activate = encodeBooleanParam(activate); }
            if (typeof(label) !== 'undefined') { args.label = label; }
            if (id) { args.id = id; }
            if (name) { args.name = name; }
            args.version = VERSION;
            execute('openSubtabByWorkSpaceName', args, callback);
        },

        /**
         * Get enclosing tab id of this frame
         */
        getEnclosingTabId:function(callback) {
            var args = {};
            args.version = VERSION;
            execute('getEnclosingTabId', args, callback);
        },

        /**
         * Get the primary tab id of this subtab
         * @param frameId id of of the current frame
         */
        getEnclosingPrimaryTabId:function(callback) {
            var args = {};
            args.version = VERSION;
            return execute('getEnclosingPrimaryTabId', args, callback);
        },

        /**
         * Gets the primary tab object id of this subtab
         */
        getEnclosingPrimaryTabObjectId:function(callback) {
            var args = {};
            args.version = VERSION;
            execute('getEnclosingPrimaryTabObjectId', args, callback);
        },

        /**
         * Returns the currently opened primary tab ids
         */
        getPrimaryTabIds:function(callback) {
            var args = {};
            args.version = VERSION;
            execute('getPrimaryTabIds', args, callback);
        },

        /**
         * Disables the current tab from closing
         */
        disableTabClose:function(disable, tabId, callback) {
            var args = {};
            args.version = VERSION;
            args.disable = disable;
            args.tabId = typeof tabId !== 'undefined' ? tabId : false;

            return execute('disableTabClose', args, callback);
        },

        /**
         * Returns the currently opened sub tab ids
         */
        getSubtabIds:function(primaryTabId, callback) {
            var args = {};
            args.version = VERSION;
            if (primaryTabId) {
                args.primaryTabId = primaryTabId;
            }
            execute('getSubtabIds', args, callback);
        },

        /**
         * Returns the page info of the entity specified by the tab
         */
        getPageInfo:function(tabId, callback) {
            var args = {};
            args.version = VERSION;
            if (tabId) {
                args.tabId = tabId;
            }
            execute('getPageInfo', args, callback);
        },

        /**
         * Gets the object id of the focused subtab
         */
        getFocusedSubtabObjectId:function(callback) {
            var args = {};
            args.version = VERSION;
            execute('getFocusedSubtabObjectId', args, callback);
        },

        resetSessionTimeOut:function() {
            var args = {};
            args.version = VERSION;
            execute('resetSessionTimeOut', args);
        },

        /**
         * Sets the tab title of the enclosing tab
         * @param label
         * @param tabId
         */
        setTabTitle:function(label, tabId) {
            var args = {};
            args.label = label;
            if (tabId) {
                args.tabId = tabId;
            }
            args.version = VERSION;
            execute('setTabTitle', args);
        },

        /**
         * Closes the tab with the given id. Note that closing the first tab in a primary tab closes the primary tab itself
         * @param id id of the view or workspace to close
         * @param callback callback executed after calling this API
         */
        closeTab:function(id, callback) {
            var args = {};
            args.id = id;
            args.version = VERSION;
            execute('closeTab', args, callback);
        },

        /**
         * Return true if this page is a console page
         */
        isInConsole: function() {
            var params = postMessageClient.parseUrlQueryString(location.search);

            // Lightning Experience
            if (params && params.clc === '1') {
                return true;
            }
            else if (params && params.clc === '0') {
                return false;
            }

            // Salesforce Classic
            var qs = location.search;
            return !(typeof sforce != "undefined" && sforce.one) &&
                (qs.length !== 0 && ((qs.indexOf("?isdtp=") > -1)
                    || (qs.indexOf("&isdtp=") > -1)))
                || canvasClient.isInConsole();
        },

        /**
         * Refreshes the tab with the given id with the last known url. Note that if the frame is cross-domain, our knowledge of the last known
         * url could be very stale. Api users should really be handling their own refreshes
         * @param version
         * @param id id of the view to refresh with last known url
         * @param activate true to activate this tab
         * @param fullRefresh true to activate a full tab refresh
         */
        refreshSubtabById: function(id, activate, callback, fullRefresh) {
            var args = {};
            if (id) { args.id = id; }
            if (typeof(activate) !== 'undefined') { args.activate = encodeBooleanParam(activate); }
            args.version = VERSION;
            args.fullRefresh = fullRefresh ? fullRefresh : false;
            execute('refreshSubtabById', args, callback);
        },
        /**
         * Refreshes the tab with the given subtab name and its workspace name with the last known url. Note that if the frame is cross-domain, our knowledge of the last known
         * url could be very stale. Api users should really be handling their own refreshes
         * @param version
         * @param name name of the subtab to refresh with last known url
         * @param workspaceName name of the primary tab of the subtab
         * @param activate true to activate this tab
         * @param fullRefresh true to activate a full tab refresh
         */
        refreshSubtabByNameAndPrimaryTabName: function(name, workspaceName, activate, callback, fullRefresh) {
            var args = {};
            if (name) { args.name = name; }
            if (workspaceName) { args.workspaceName = workspaceName; }
            if (typeof(activate) !== 'undefined') { args.activate = encodeBooleanParam(activate); }
            args.version = VERSION;
            args.fullRefresh = fullRefresh ? fullRefresh : false;
            execute('refreshSubtabByNameAndWorkspaceName', args, callback);
        },

        /**
         * Refreshes the tab with the given subtab name and its workspace id with the last known url. Note that if the frame is cross-domain, our knowledge of the last known
         * url could be very stale. Api users should really be handling their own refreshes
         * @param version
         * @param name name of the subtab to refresh with last known url
         * @param workspaceId id of the primary tab of the subtab
         * @param activate true to activate this tab
         * @param fullRefresh true to activate a full tab refresh
         */
        refreshSubtabByNameAndPrimaryTabId: function(name, workspaceId, activate, callback, fullRefresh) {
            var args = {};
            if (name) { args.name = name; }
            if (workspaceId) { args.workspaceId = workspaceId; }
            if (typeof(activate) !== 'undefined') { args.activate = encodeBooleanParam(activate); }
            args.version = VERSION;
            args.fullRefresh = fullRefresh ? fullRefresh : false;
            execute('refreshSubtabByNameAndWorkspaceId', args, callback);
        },

        /**
         * Refreshes the primary tab with the given id. Note the each tab refresh behavior is the same as refreshSubtab methods
         * @param workspaceId id of the primary tab
         * @param activate true to activate this tab
         * @param fullRefresh true to activate a full tab refresh
         */
        refreshPrimaryTabById: function(id, activate, callback, fullRefresh) {
            var args = {};
            if (id) { args.id = id; }
            if (typeof(activate) !== 'undefined') { args.activate = encodeBooleanParam(activate); }
            args.version = VERSION;
            args.fullRefresh = fullRefresh ? fullRefresh : false;
            execute('refreshPrimaryTabById', args, callback);
        },

        /**
         * Refreshes the primary tab with the given name. Note the each tab refresh behavior is the same as refreshSubtab methods
         * @param name name of the primary tab
         * @param activate true to activate this tab
         * @param fullRefresh true to activate a full tab refresh
         */
        refreshPrimaryTabByName: function(name, activate, callback, fullRefresh) {
            var args = {};
            if (name) { args.name = name; }
            if (typeof(activate) !== 'undefined') { args.activate = encodeBooleanParam(activate); }
            args.version = VERSION;
            args.fullRefresh = fullRefresh ? fullRefresh : false;
            execute('refreshPrimaryTabByName', args, callback);
        },

        /**
         * Re-open last closed tab.
         */
        reopenLastClosedTab: function(callback) {
            var args = {};
            args.version = VERSION;
            execute('reopenLastClosedTab', args, callback);
        },

        /**
         * Activates the tab with the given id
         * @param version
         * @param id id of the view
         */
        focusSubtabById: function(id, callback) {
            var args = {};
            if (id) { args.id = id; }
            args.version = VERSION;
            execute('focusSubtabById', args, callback);
        },

        /**
         * Activates the tab with the given subtab name and its workspace name
         * @param version
         * @param name name of the subtab
         * @param workspaceName name of the primary tab of the subtab
         */
        focusSubtabByNameAndPrimaryTabName: function(name, workspaceName, callback) {
            var args = {};
            if (name) { args.name = name; }
            if (workspaceName) { args.workspaceName = workspaceName; }
            args.version = VERSION;
            execute('focusSubtabByNameAndWorkspaceName', args, callback);
        },

        /**
         * Activates the tab with the given subtab name and its workspace id
         * @param version
         * @param name name of the subtab to refresh with last known url
         * @param workspaceId id of the primary tab of the subtab
         */
        focusSubtabByNameAndPrimaryTabId: function(name, workspaceId, callback) {
            var args = {};
            if (name) { args.name = name; }
            if (workspaceId) { args.workspaceId = workspaceId; }
            args.version = VERSION;
            execute('focusSubtabByNameAndWorkspaceId', args, callback);
        },

        /**
         * Activates the primary tab with the given id.
         * @param workspaceId id of the primary tab
         */
        focusPrimaryTabById: function(id, callback) {
            var args = {};
            if (id) { args.id = id; }
            args.version = VERSION;
            execute('focusPrimaryTabById', args, callback);
        },

        /**
         * Activates the primary tab with the given name.
         */
        focusPrimaryTabByName: function(name, callback) {
            var args = {};
            if (name) { args.name = name; }
            args.version = VERSION;
            execute('focusPrimaryTabByName', args, callback);
        },

        /**
         * sets myself dirty
         * @param dirtyState to set current tab to dirty, can be true or false
         * @param callback
         * @param subtabId
         */
        setTabUnsavedChanges:function(dirtyState, callback, subtabId) {
            var args = {};
            if (typeof(dirtyState) !== 'undefined') { args.isDirty = encodeBooleanParam(dirtyState); }
            args.version = VERSION;
            if (subtabId) {
                args.subtabId = subtabId;
            }
            execute('setTabDirty', args, callback);
        },

        /**
         * Register event handler that will be called when the user clicks 'Save'
         * from the 'Unsaved Changes' dialog upon closing a dirty tab.
         */
        onTabSave:function(eventHandler) {
            var args = {};
            args.version = VERSION;
            args.event = true;
            execute('onTabSave', args, eventHandler);
        },

        /**
         * Register event handler that will be fired when focus changes to a different subtab
         */
        onFocusedSubtab:function(eventHandler) {
            var args = {};
            args.version = VERSION;
            args.event = true;
            execute('onFocusedSubtab', args, eventHandler);
        },

        /**
         * Register event handler that will be fired when focus changes to a different subtab
         */
        onFocusedPrimaryTab:function(eventHandler) {
            var args = {};
            args.version = VERSION;
            args.event = true;
            execute('onFocusedPrimaryTab', args, eventHandler);
        },

        /**
         * Register event handler that will be fired when enclosing tab refreshes
         */
        onEnclosingTabRefresh:function(eventHandler) {
            var args = {};
            args.version = VERSION;
            args.event = true;
            execute('onEnclosingTabRefresh', args, eventHandler);
        },

        /**
         * Console-level API
         */

        /**
         * Get the id of the currently focused primary tab
         */
        getFocusedPrimaryTabId:function(callback) {
            var args = {};
            args.version = VERSION;
            execute('getFocusedPrimaryTabId', args, callback);
        },

        /**
         * Get the object id of the currently focused primary tab
         */
        getFocusedPrimaryTabObjectId:function(callback) {
            var args = {};
            args.version = VERSION;
            execute('getFocusedPrimaryTabObjectId', args, callback);
        },

        /**
         * Get the id of the currently focused subtab
         */
        getFocusedSubtabId:function(callback) {
            var args = {};
            args.version = VERSION;
            execute('getFocusedSubtabId', args, callback);
        },

        /**
         * Custom Console Component API
         */

        /**
         * Check if the current page is rendered within a Custom Console Component
         */
        isInCustomConsoleComponent:function(callback) {
            var args = {};
            args.version = VERSION;
            execute('isInCustomConsoleComponent', args, callback);
        },

        /**
         * Set the button text of the Custom Console Component in which the page is rendered
         */
        setCustomConsoleComponentButtonText:function(text, callback) {
            var args = {};
            args.version = VERSION;
            args.text = text;
            execute('setCustomConsoleComponentButtonText', args, callback);
        },

        /**
         * Set the button style of the Custom Console Component in which the page is rendered
         */
        setCustomConsoleComponentButtonStyle:function(style, callback) {
            var args = {};
            args.version = VERSION;
            args.style = style;
            execute('setCustomConsoleComponentButtonStyle', args, callback);
        },

        /**
         * Set the button icon URL of the Custom Console Component in which the page is rendered
         */
        setCustomConsoleComponentButtonIconUrl:function(iconUrl, callback) {
            var args = {};
            args.version = VERSION;
            args.iconUrl = iconUrl;
            execute('setCustomConsoleComponentButtonIconUrl', args, callback);
        },

        /**
         * Set the window visibility of the Custom Console Component in which the page is rendered
         */
        setCustomConsoleComponentVisible:function(visible, callback) {
            var args = {};
            args.version = VERSION;
            args.visible = encodeBooleanParam(visible);
            execute('setCustomConsoleComponentWindowVisible', args, callback);
        },

        /**
         * Know if the Custom Console Component window is visible or not
         */
        isCustomConsoleComponentHidden:function(callback) {
            var args = {};
            args.version = VERSION;
            execute('isCustomConsoleComponentWindowHidden', args, callback);
        },

        /**
         * Set the window width of the Custom Console Component in which the page is rendered
         */
        setCustomConsoleComponentWidth:function(width, callback) {
            var args = {};
            args.version = VERSION;
            args.width = width;
            execute('setCustomConsoleComponentWidth', args, callback);
        },

        /**
         * Set the window height of the Custom Console Component in which the page is rendered
         */
        setCustomConsoleComponentHeight:function(height, callback) {
            var args = {};
            args.version = VERSION;
            args.height = height;
            execute('setCustomConsoleComponentHeight', args, callback);
        },

        /**
         * Register event handler that will be called when the Custom Console Component button is clicked
         */
        onCustomConsoleComponentButtonClicked:function(eventHandler) {
            var args = {};
            args.version = VERSION;
            args.event = true;
            execute('onCustomConsoleComponentButtonClicked', args, eventHandler);
        },

        /**
         * Scroll the button text of the Custom Console Component in a fixed interval
         */
        scrollCustomConsoleComponentButtonText:function(interval, pixelsToScroll, isLeftScrolling, callback) {
            var args = {};
            args.version = VERSION;
            args.interval = interval;
            args.pixelsToScroll = pixelsToScroll;
            args.isLeftScrolling = encodeBooleanParam(isLeftScrolling);
            execute('scrollCustomConsoleComponentButtonText', args, callback);
        },

        /**
         * Cancel the scrolling of Custom Console Component button text
         */
        removeScrollCustomConsoleComponentButtonText:function(callback) {
            var args = {};
            args.version = VERSION;
            execute('removeScrollCustomConsoleComponentButtonText', args, callback);
        },

        /**
         * Blink the button text of the Custom Console Component in a fixed interval
         */
        blinkCustomConsoleComponentButtonText:function(alternateText, interval, callback) {
            var args = {};
            args.version = VERSION;
            args.alternateText = alternateText;
            args.interval = interval;
            execute('blinkCustomConsoleComponentButtonText', args, callback);
        },

        /**
         * Cancel the blinking of Custom Console Component button text
         */
        removeBlinkCustomConsoleComponentButtonText:function(callback) {
            var args = {};
            args.version = VERSION;
            execute('removeBlinkCustomConsoleComponentButtonText', args, callback);
        },

        /**
         * Set whether the Custom Console Component is popoutable or not
         */
        setCustomConsoleComponentPopoutable:function(popoutable, callback) {
            var args = {};
            args.version = VERSION;
            args.popoutable = !!popoutable;
            execute('setCustomConsoleComponentPopoutable', args, callback);
        },

        /**
         * Know if the Custom Console Component is popped out or not
         */
        isCustomConsoleComponentPoppedOut:function(callback) {
            var args = {};
            args.version = VERSION;
            execute('isCustomConsoleComponentPoppedOut', args, callback);
        },

        /**
         * Add a listener for the specified event type
         */
        addEventListener:function(eventType, eventHandler, additionalParams) {
            if (!(validateEventType(eventType) && validateEventHandler(eventHandler))) {
                return;
            }

            if (ConsoleEventManager.isConsoleEventType(eventType)) {
                // additional processing for console events
                eventType = ConsoleEventManager.getFullyQualifiedEventType(eventType, additionalParams);
            }

            var args = {};
            args.version = VERSION;
            args.event = true;
            args.eventType = eventType;
            execute(ADD_EVENT_LISTENER, args, eventHandler);
        },

        /**
         * Remove a listener for the specified event type
         */
        removeEventListener:function(eventType, eventHandler, additionalParams) {
            if (!(validateEventType(eventType) && validateEventHandler(eventHandler))) {
                return;
            }

            if (ConsoleEventManager.isConsoleEventType(eventType)) {
                // additional processing for console events
                eventType = ConsoleEventManager.getFullyQualifiedEventType(eventType, additionalParams);
            }

            var args = {};
            args.version = VERSION;
            args.eventType = eventType;
            var cleanUpOptions = registry.getFunction(ADD_EVENT_LISTENER).func.del(eventHandler, args);
            if (cleanUpOptions) {
                args.unregisterFrameForEvent = cleanUpOptions.unregisterFrameForEvent;
                args.unregisterFrameForEveryEvent = cleanUpOptions.unregisterFrameForEveryEvent;
            }

            if (args.removeFrameFromEvent || args.removeFrameFromEveryEvent) {
                execute('removeEventListener', args);
            }
        },

        /**
         * Fire an event of the specified type
         */
        fireEvent:function(eventType, message, callback) {
            if (!validateEventType(eventType)) {
                return;
            }

            var args = {};
            args.version = VERSION;
            args.eventType = eventType;
            args.message = message;
            execute('fireEvent', args, callback);
        },

        /**
         * enum representing the types of console events
         */
        ConsoleEvent: ConsoleEventManager.getTypes(),

        /**
         * add a listener to a push notification based on given entities
         */
        addPushNotificationListener:function(entities, callback) {
            var args = {};
            // only allow one listener
            if (registry.getFunction(ADD_PUSH_NOTIFICATION_LISTENER)) {
                if (window.console && console.log) {
                    console.log('There already exists a listener for the push notification on this page');
                }
                return false;
            }
            args.version = VERSION;
            args.entities = entities;
            args.event = true;
            execute(ADD_PUSH_NOTIFICATION_LISTENER, args, callback);
        },

        removePushNotificationListener:function(callback) {
            if (registry.getFunction(ADD_PUSH_NOTIFICATION_LISTENER)) {
                registry.removeFunction(ADD_PUSH_NOTIFICATION_LISTENER);
                var args = {};
                args.version = VERSION;
                execute('removePushNotificationListener', args, callback);
            }
        },

        /**
         * add a browser tab title to a list of titles rotating every three seconds
         */
        addToBrowserTitleQueue:function(title, callback) {
            var args = {};
            args.version = VERSION;
            if (title) {
                args.title = title;
            }
            execute('addToBrowserTitleQueue', args, callback);
        },

        /**
         * remove a browser tab title from the list of titles rotating every three seconds
         */
        removeFromBrowserTitleQueue:function(title, callback) {
            var args = {};
            args.version = VERSION;
            if (title) {
                args.title = title;
            }
            execute('removeFromBrowserTitleQueue', args, callback);
        },

        /**
         * retrieve tab link based on level & id passed in
         */
        getTabLink:function(level, tabId, callback) {
            var args = {};
            args.version = VERSION;
            if(level) {
                args.level = level;
            }
            if(tabId) {
                args.tabId = tabId;
            }
            execute('getTabLink', args, callback);
        },

        /**
         * customize the CSS styling of a tab based on the passed-in tabId and style
         */
        setTabStyle:function(style, tabId, callback) {
            var args = {};

            if (style) {
                args.css = style;
            }

            if (tabId) {
                args.tabId = tabId;
            }

            args.version = VERSION;
            execute('setTabStyle', args, callback);
        },

        /**
         * customize the CSS styling of a tab's text based on the passed-in tabId and style
         */
        setTabTextStyle:function(style, tabId, callback) {
            var args = {};

            if (style) {
                args.css = style;
            }

            if (tabId) {
                args.tabId = tabId;
            }

            args.version = VERSION;
            execute('setTabTextStyle', args, callback);
        },

        /**
         * customize the icon of a tab based on the passed-in tabId and iconUrl
         */
        setTabIcon:function(iconUrl, tabId, callback) {
            var args = {};

            if (iconUrl) {
                args.iconUrl = iconUrl;
            }

            if (tabId) {
                args.tabId = tabId;
            }

            args.version = VERSION;
            execute('setTabIcon', args, callback);
        },

        /**
         * enum representing the level of tab link you want, for getTabLink
         */
        TabLink: {
            PARENT_AND_CHILDREN:'complete',
            TAB_ONLY:'thistabonly',
            SALESFORCE_URL:'standard'
        },

        /**
         * enum representing the console regions, for setSidebarVisible
         */
        Region: {
            LEFT:'left',
            RIGHT:'right',
            TOP:'top',
            BOTTOM:'bottom'
        },

        ComponentType: {
            CANVAS: 'CANVAS',
            CASE_EXPERTS_WIDGET: 'CASE_EXPERTS_WIDGET',
            FILES_WIDGET: 'FILES_WIDGET',
            HIGHLIGHTS_PANEL: 'HIGHLIGHTS_PANEL',
            INTERACTION_LOG_PANEL: 'INTERACTION_LOG_PANEL',
            KNOWLEDGE_ONE: 'KNOWLEDGE_ONE',
            LOOKUP: 'LOOKUP',
            MILESTONE_WIDGET: 'MILESTONE_WIDGET',
            RELATED_LIST: 'RELATED_LIST',
            REPORT_CHART_WIDGET: 'REPORT_CHART_WIDGET',
            TOPICS_WIDGET: 'TOPICS_WIDGET',
            VISUALFORCE: 'VISUALFORCE'
        },

        /**
         * set the link for the current external subtab
         */
        setTabLink:function(callback) {
            var args = {};
            args.version = VERSION;
            args.link = window.location.href;
            execute('setTabLink', args, callback);
        },

        /**
         * generate a console url based on a number of passed in urls
         */
        generateConsoleUrl:function(urls, callback) {
            var args = {};
            args.version = VERSION;
            if(urls) {
                args.urls = urls;
            }
            execute('generateConsoleUrl', args, callback);
        },

        /**
         * Opens a console URL
         * 1.  The passed-in console link will always be opened as a primary tab.
         * 2.  The target tab id is optional, if passed-in, it must be a primary tab ID
         * 3.  The first entry in tabLabels as well as tabNames is used to override primary tab, the rest are the subsequent subtabs
         */
        openConsoleUrl:function(tabId, consoleUrl, active, tabLabels, tabNames, callback) {
            var args = {};
            args.version = VERSION;
            if(tabId) {
                args.tabId = tabId;
            }

            if(consoleUrl) {
                args.consoleUrl = consoleUrl;
            }

            if (typeof(active) !== 'undefined') {
                args.active = encodeBooleanParam(active);
            }

            if(tabLabels) {
                args.tabLabels = tabLabels;
            }

            if(tabNames) {
                args.tabNames = tabNames;
            }
            execute('openConsoleUrl', args, callback);
        },

        /**
         * Method to get the unique identifier of selected tab
         */
        getSelectedNavigationTab : function(callback) {
            var args = {};
            args.version = VERSION;
            execute('getSelectedNavigationTab', args, callback);
        },


        /**
         * Method to set Navigation tab with tab unique identifier
         */
        setSelectedNavigationTab : function(callback, navigationTabId,listViewUrl) {
            var args = {};
            args.version = VERSION;

            if (listViewUrl) {
                args.listViewUrl = listViewUrl;
            }
            if (navigationTabId) {
                args.navigationTabId = navigationTabId;
            }

            execute('setSelectedNavigationTab', args, callback);
        },
        /**
         * Method to get all the items in the navigation panel
         */
        getNavigationTabs : function(callback) {
            var args = {};
            args.version = VERSION;
            execute('getNavigationTabs', args, callback);
        },


        /**
         * Method to focus on the navigation panel
         */
        focusNavigationTab : function(callback) {
            var args = {};
            args.version = VERSION;
            execute('focusNavigationTab', args, callback);
        },

        /**
         * Method to refresh on the navigation panel
         */
        refreshNavigationTab : function(callback) {
            var args = {};
            args.version = VERSION;
            execute('refreshNavigationTab', args, callback);
        },

        /**
         * Focus on a sidebar component.
         * @param {String} componentInfo JSON String
         * @param {String} tabId
         * @param {Object} callback
         */
        focusSidebarComponent:function(componentInfo, tabId, callback) {
            var args = {};
            args.version = VERSION;

            if (componentInfo) {
                args.componentInfo = componentInfo;
            }

            if (tabId) {
                args.tabId = tabId;
            }
            execute('focusSidebarComponent', args, callback);
        },

        /**
         * Method to set sidebar visible or not
         */
        setSidebarVisible:function(visible, tabId, region, callback) {
            var args = {};
            args.version = VERSION;
            if (typeof visible === 'boolean'){
                args.visible = visible;
            }
            if (tabId) {
                args.tabId = tabId;
            }
            if (region) {
                args.region = region.toLowerCase();
            }
            execute('setSidebarVisible', args, callback);
        },

        /**
         * Selects (and displays) the given macro
         * @param macroId Id of macro to be selected
         * @param callback Guaranteed to be called after the operation is fully completed
         */
        selectMacro:function(macroId, callback) {
            var args = {};
            args.version = VERSION;
            args.macroId = macroId;
            execute('selectMacro', args, callback);
        },

        /**
         * Runs the selected macro
         * @param callback Guaranteed to be called after the operation is fully completed
         */
        runSelectedMacro:function(callback) {
            var args = {};
            args.version = VERSION;
            execute('runSelectedMacro', args, callback);
        },

        /**
         * Modules supported by the integration toolkit
         */
        modules : {
            CTI : 'CTI',
            CHAT : 'CHAT'
        },

        helper : (function() {
            return {
                execute : function() {
                    // delegate to the private execute() function
                    return execute.apply(null, arguments);
                },

                getVersion : function() {
                    return VERSION;
                }
            };
        })(),

        /**
         * Dynamically load the specified module
         */
        include : function(moduleName, callback, scope) {
            var pathToModule = '/support/console/' + this.helper.getVersion() + '/integration_' + moduleName + '.js';
            var head = document.getElementsByTagName('head')[0];
            var script = document.createElement('script');
            var onLoadHandler = function() {
                // invoke callback and remove the script element which is no longer needed
                callback.call(scope);
                head.removeChild(script);
            };

            // load the module via a script element
            script.type = 'text/javascript';
            script.onreadystatechange = function() {
               if (this.readyState === 'complete') {
                   onLoadHandler();
               }
            };
            script.onload = onLoadHandler;
            script.src = pathToModule;
            head.appendChild(script);
        },

        isCanvasContext : function() {
            return canvasClient.isCanvasContext();
        }
    };
})();

/**
 * CTI Toolkit API
 */
sforce.console.cti = (function(consoleApiHelper) {
    var execute = function(fname, args, callback) {
        args.version = consoleApiHelper.getVersion();
        return consoleApiHelper.execute(fname, args, callback);
    };

    return {
        /**
         * Returns active call object ids in the order in which they arrived.
         */
        getCallObjectIds:function(callback) {
            var args = {};
            execute('getCallObjectIds', args, callback);
        },

       /**
        * Set active call object ids, where object id at index 0 arrived first
        * and object id at index n-1 arrived last.
        */
        setCallObjectIds:function(callObjectIds, callback) {
            var args = {};
            args.callObjectIds = callObjectIds;
            execute('setCallObjectIds', args, callback);
        },

        /**
         * Returns JSON formatted call attached data of current call, taken from screen pop payload.
         */
        getCallAttachedData:function(callObjectId, callback, additionalParams) {
            var args = {};
            args.callObjectId = callObjectId;
            if (typeof additionalParams === 'object' && additionalParams.hasOwnProperty('getCallType')) {
                args.getCallType = additionalParams.getCallType;
            }
            execute('getCallAttachedData', args, callback);
        },

        /**
         * Sets the call data associated with a call object id.
         */
        setCallAttachedData:function(callObjectId, callData, callType, callback) {
            var args = {};
            args.callObjectId = callObjectId;
            args.callData = callData;
            args.callType = callType;
            execute('setCallAttachedData', args, callback);
        },

        /**
         * Register event handler that will be fired when a call begins.
         */
        onCallBegin:function(eventHandler) {
            var args = {};
            args.event = true;
            execute('onCallBegin', args, eventHandler);
        },

        /**
         * Fires CTI begin call event to notify that a call has started.
         */
        fireOnCallBegin:function(callObjectId, callType, callLabel, callback) {
            var args = {};
            args.callObjectId = callObjectId;
            args.callType = callType;
            args.callLabel = callLabel;
            execute('fireOnCallBegin', args, callback);
        },

        /**
         * Fires CTI end call event to notify that a call has ended.
         */
        fireOnCallEnd:function(callObjectId, callDuration, callDisposition, callback) {
            var args = {};
            args.callObjectId = callObjectId;
            args.callDuration = callDuration;
            args.callDisposition = callDisposition;
            execute('fireOnCallEnd', args, callback);
        },

        /**
         * Register event handler that will be fired when a call ends.
         * CallObjectId is optional, and if specified, event handler is removed after it is fired.
         */
        onCallEnd:function(eventHandler, callObjectId) {
            var args = {};
            args.callObjectId = callObjectId ? callObjectId : null;
            args.event = true;
            execute('onCallEnd', args, eventHandler);
        },

        /**
         * Sends a CTI message
         */
        sendCTIMessage:function(msg, callback) {
            var args = {};
            args.msg = msg;
            execute('sendCTIMessage', args, callback);
        },

        /**
         * Registers a function that is fired when a message is sent with sendCTIMessage API.
         */
        onSendCTIMessage:function(eventHandler) {
            var args = {};
            args.event = true;
            execute('onSendCTIMessage', args, eventHandler);
        },

        /**
         * Registers a function that is fired when the interaction log saves a call log.
         */
        onCallLogSaved:function(eventHandler) {
            var args = {};
            args.event = true;
            execute('onCallLogSaved', args, eventHandler);
        },

        /**
         * Fires onCallLogSaved event to notify listeners that a call log was saved.
         */
        fireOnCallLogSaved:function(id, callback) {
            var args = {};
            args.id = id;
            execute('fireOnCallLogSaved', args, callback);
        }
    };
})(sforce.console.helper);

/**
 * Chat Toolkit API
 */
sforce.console.chat = (function(consoleApiHelper) {
    var execute = function(fname, args, callback) {
        args.version = consoleApiHelper.getVersion();
        return consoleApiHelper.execute(fname, args, callback);
    };

    return {
        /**
         * Retrieves the details for a given primary tab.
         */
        getDetailsByPrimaryTabId: function(primaryTabId, callback) {
            var args = {};
            args.primaryTabId = primaryTabId;
            execute('chatGetDetailsByPrimaryTabId', args, function(res) {
                callback.call(this, {"success": res.success, "primaryTabId": res.primaryTabId ? res.primaryTabId : null, "details": res.result ? JSON.parse(res.result) : null});
            });
        },

        /**
         * Retrieves the details for a given chat
         */
        getDetailsByChatKey: function(chatKey, callback) {
            var args = {};
            args.chatKey = chatKey;
            execute('chatGetDetailsByChatKey', args, function(res) {
                callback.call(this, {"success": res.success, "primaryTabId": res.primaryTabId ? res.primaryTabId : null, "details": res.result ? JSON.parse(res.result) : null});
            });
        },

        /**
         * Retrieves the chat log for a given chat
         */
        getChatLog: function(chatKey, callback) {
            var args = {};
            args.chatKey = chatKey;
            execute('chatGetChatLog', args, function(res) {
                var resultObj = res.result ? JSON.parse(res.result) : null;
                callback.call(this, {"success": res.success, "messages": resultObj ? resultObj.messages : null, "customEvents": resultObj ? resultObj.customEvents : null});
            });
        },

        /**
         * Retrieves the current text entered in the agent's input box
         */
        getAgentInput: function(chatKey, callback) {
            var args = {};
            args.chatKey = chatKey;
            execute('chatGetAgentInput', args, callback);
        },

        /**
         * Sets the current text entered in the agent's input box
         */
        setAgentInput: function(chatKey, text, callback) {
            var args = {};
            args.chatKey = chatKey;
            args.text = text;
            execute('chatSetAgentInput', args, callback);
        },

        /**
         * Sends a message to the chat client
         */
        sendMessage: function(chatKey, message, callback) {
            var args = {};
            args.chatKey = chatKey;
            args.message = message;
            execute('chatSendMessage', args, callback);
        },

        /**
         * on new chat message
         */
        onNewMessage: function(chatKey, callback) {
            var args = {};
            args.chatKey = chatKey;
            args.event = true;
            args.eventId = chatKey;
            execute('chatOnNewMessage', args, callback);
        },

        /**
         * on agent message from UI
         */
        onAgentSend: function(chatKey, callback) {
            var args = {};
            args.chatKey = chatKey;
            args.event = true;
            args.eventId = chatKey;
            execute('chatOnAgentSend', args, callback);
        },

        /**
         * on typing update
         */
        onTypingUpdate: function(chatKey, callback) {
            var args = {};
            args.chatKey = chatKey;
            args.event = true;
            args.eventId = chatKey;
            execute('chatOnTypingUpdate', args, callback);
        },

        /**
         * on custom event
         */
        onCustomEvent: function(chatKey, type, callback) {
            var args = {};
            args.chatKey = chatKey;
            args.type = type;
            args.event = true;
            args.eventId = chatKey+type;
            execute('chatOnCustomEvent', args, callback);
        },

        /**
         * Sends a custom event to the chat client
         */
        sendCustomEvent: function(chatKey, type, data, callback) {
            var args = {};
            args.chatKey = chatKey;
            args.type = type;
            args.data = data;
            execute('chatSendCustomEvent', args, callback);
        },

        /**
        * Get the maximum number of chats an agent is allowed to handle concurrently
        **/
        getMaxCapacity: function(callback) {
            var args = {};
            execute('getMaxCapacity', args, callback);
        },

        /**
        * Get the current number of engaged chats
        **/
        getEngagedChats: function(callback) {
            var args = {};
            execute('getEngagedChats', args, function(res) { callback.call(this, {success:res.success, chatKey: (res.chatKey.length ===1 && res.chatKey[0].length===0)? []:res.chatKey}); });
        },

        /**
        * Get the current number of engaged chats
        **/
        getChatRequests: function(callback) {
            var args = {};
            execute('getChatRequests', args, function(res) { callback.call(this, {success:res.success, chatKey: (res.chatKey.length ===1 && res.chatKey[0].length===0)? []:res.chatKey}); });
        },

        /**
        * get agent's current state
        **/
        getAgentState: function(callback) {
            var args = {};
            execute('getAgentState', args, callback);
        },

        /**
        * set agent state
        **/
        setAgentState: function(state, callback) {
            var args = {};
            args.state = state;
            execute('setAgentState', args, callback);
        },

        /**
        * on agent state changed
        **/
        onAgentStateChanged: function(callback) {
            var args = {};
            args.event = true;
            execute('onAgentStateChanged', args, callback);
        },

        /**
        * on capacity changed
        **/
        onCurrentCapacityChanged: function(callback) {
            var args = {};
            args.event = true;
            execute('onCurrentCapacityChanged', args, callback);
        },

        /**
        * on chat requested
        **/
        onChatRequested: function(callback) {
            var args = {};
            args.event = true;
            execute('onChatRequested', args, callback);
        },

        /**
        * on chat started
        **/
        onChatStarted: function(callback) {
            var args = {};
            args.event = true;
            execute('onChatStarted', args, callback);
        },

        /**
        * on chat ended
        **/
        onChatEnded: function(callback) {
            var args = {};
            args.event = true;
            execute('onChatEnded', args, callback);
        },

        /**
        * on chat declined
        **/
        onChatDeclined: function(callback) {
            var args = {};
            args.event = true;
            execute('onChatDeclined', args, callback);
        },

        /**
        * on chat transferred out
        **/
        onChatTransferredOut: function(callback) {
            var args = {};
            args.event = true;
            execute('onChatTransferredOut', args, callback);
        },

        /**
        * on the event when user cancels chat request before chat was accepted by the agent
        **/
        onChatCanceled: function(callback) {
            var args = {};
            args.event = true;
            execute('onChatCanceled', args, callback);
        },

        /**
        * on chat going in or out of critical wait state
        **/
        onChatCriticalWaitState: function(chatKey, callback) {
            var args = {};
            args.event = true;
            args.chatId = chatKey;
            execute('onChatCriticalWaitState', args, callback);
        },

        /**
        * accept chat
        **/
        acceptChat: function(chatKey, callback) {
            var args = {};
            args.chatKey = chatKey;
            args.eventId = chatKey;
            execute('acceptChat', args, callback);
        },

        /**
        * end chat
        **/
        endChat: function(chatKey, callback) {
            var args = {};
            args.chatKey = chatKey;
            execute('endChat', args, callback);
        },
        /**
        * decline chat
        **/
        declineChat: function(chatKey, callback) {
            var args = {};
            args.chatKey = chatKey;
            execute('declineChat', args, callback);
        },
        /**
         * file transfer, init by agent
         */
        initFileTransfer: function(chatKey, entityId, callback) {
            var args = {};
            args.chatKey = chatKey;
            args.entityId = entityId;
            execute('initFileTransfer', args, callback);
        },
        /**
         * file transfer, cancel by agent
         */
        cancelFileTransferByAgent: function(chatKey, callback) {
            var args = {};
            args.chatKey = chatKey;
            execute('cancelFileTransfer', args, callback);
        },
        /**
         * file transfer, file completed
         */
        onFileTransferCompleted: function(chatKey, callback) {
            var args = {};
            args.chatKey = chatKey;
            execute('onFileTransferCompleted', args, callback);
        },
        /**
         * raise flag on chat
         */
        raiseFlag: function(chatKey, message, callback) {
            var args = {};
            args.chatKey = chatKey;
            args.message = message;
            execute('raiseFlag', args, callback);
        },
        /**
         * lower flag on chat
         */
        lowerFlag: function(chatKey, callback) {
            var args = {};
            args.chatKey = chatKey;
            execute('lowerFlag', args, callback);
        }
    };
})(sforce.console.helper);

/**
 * Service Presence Toolkit API
 */
sforce.console.presence = (function(consoleApiHelper) {
    var execute = function(fname, args, callback) {
        args.version = consoleApiHelper.getVersion();
        return consoleApiHelper.execute(fname, args, callback);
    };

    function validateStringArg(arg) {
        return (typeof arg === 'string' && arg.length > 0);
    }

    return {

        /**
        * login a presence user with given status id
        **/
        login: function(statusId, callback) {
            var args = {};
            if (validateStringArg(statusId)) {
                args.statusId = statusId;
            }
            execute('loginPresence', args, callback);
        },

        /**
        * get presence user's status id
        **/
        getServicePresenceStatusId: function(callback) {
             var args = {};
             execute('getPresenceStatusId', args, callback);
        },

        /**
        * get presence user current status' channels
        */
        getServicePresenceStatusChannels: function(callback) {
             var args = {};
             execute('getPresenceStatusChannels', args, callback);
        },

        /**
        * set presence user's status with give status id
        **/
        setServicePresenceStatus: function(statusId, callback) {
            var args = {};
            if (validateStringArg(statusId)) {
                args.statusId = statusId;
            }
            execute('setPresenceStatus', args, callback);
        },

        /**
         * logout a presence user
         **/
        logout: function(callback) {
            var args = {};
            execute('logoutPresence', args, callback);
        },

        /**
         * Get all works assigned/opened by presence user
         */
        getAgentWorks: function(callback) {
            var args = {};
            execute('getPresenceWorks', args, callback);
        },

        /**
         * Accept an assigned work
         */
        acceptAgentWork: function(workId, callback) {
            var args = {};
            if (validateStringArg(workId)) {
                args.workId = workId;
            }
            execute('acceptPresenceWork', args, callback);
        },

        /**
         * Decline an assigned work
         */
        declineAgentWork: function(workId, declineReason, callback) {
            var args = {};
            if (validateStringArg(workId)) {
                args.workId = workId;
                args.declineReason = declineReason;
            }
            execute('declinePresenceWork', args, callback);
        },

        /**
         * Close an engaged work
         */
        closeAgentWork: function(workId, callback) {
            var args = {};
            if (validateStringArg(workId)) {
                args.workId = workId;
            }
            execute('closePresenceWork', args, callback);
        },

        /**
         * Get configured capacity and current assigned workload
         */
        getAgentWorkload: function(callback) {
            var args = {};
            execute('getAgentWorkload', args, callback);
        }
    };
})(sforce.console.helper);