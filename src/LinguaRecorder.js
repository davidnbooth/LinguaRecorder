'use strict';

var STATE = {
	stop: 'stop',
	listening: 'listen',
	recording: 'record',
	paused: 'pause',
}

/*
TODO
- benefit from the MediaTrackConstraints when geting the stream
- replace STATE
*/

/**
 *
 *
 * @constructor
 * @param {Object} [config] Configuration options
 * @cfg {boolean} [autoStart=false] Set to true to wait for voice detection when calling the start() method.
 * @cfg {boolean} [autoStop=false] Set to true to stop the record when there is a silence.
 * @cfg {number} [bufferSize=4096] Set the size of the samples buffers. Could be 0 (let the browser choose the best one) or one of the following values: 256, 512, 1024, 2048, 4096, 8192, 16384; the less the more precise, the higher the more efficient.
 * @cfg {number} [timeLimit=0] Maximum time (in seconds) after which it is necessary to stop recording. Set to 0 (default) for no time limit.
 * @cfg {string} [onSaturate='none'] Tell what to do when a record is saturated. Accepted values are 'none' (default), 'cancel' and 'discard'.
 * @cfg {number} [saturationThreshold=0.99] Amplitude value between 0 and 1 included. Only used if onSaturate is different from 'none'. Threshold above which a record should be flagged as saturated.
 * @cfg {number} [startThreshold=0.1] Amplitude value between 0 and 1 included. Only used if autoStart is set to true. Amplitude to reach to auto-start the recording.
 * @cfg {number} [stopThreshold=0.05] Amplitude value between 0 and 1 included. Only used if autoStop is set to true. Amplitude not to exceed in a stopDuration interval to auto-stop recording.
 * @cfg {number} [stopDuration=0.3] Duration value in seconds. Only used if autoStop is set to true. Duration during which not to exceed the stopThreshold in order to auto-stop recording.
 * @cfg {number} [marginBefore=0.25] Duration value in seconds. Only used if autoStart is set to true.
 * @cfg {number} [marginAfter=0.25] Duration value in seconds. Only used if autoStop is set to true.
 * @cfg {number} [minDuration=0.15] Duration value in seconds. Discard the record if it last less than minDuration. Default value to 0.15, use 0 to disable.
 */
var LinguaRecorder = function( config ) {
	this.stream = null;

	// TODO: create a setConfig method
	this.recordProcessorConfig = config || {};

	this._state = STATE.stop;

	this._eventHandlers = {
		ready: [],
		readyFail: [],
		started: [],
		listening: [],
		recording: [],
		saturated: [],
		paused: [],
		stoped: [],
		canceled: [],
	};
	this._eventStorage = {
		ready: null,
		readyFail: null,
	};
	this._extraAudioNodes = [];

	this._getAudioStream();
};




/**
 * Return the current duration of the recording.
 *
 * @return {number} The duration in seconds
 */
LinguaRecorder.prototype.getRecordingTime = function() {
	//TODO: update this
	return this._audioRecord.getDuration();
};


/**
 * Return the current state of the recorder.
 *
 * @return {string} One of the following: 'stop', 'listening', 'recording', 'paused'
 */
LinguaRecorder.prototype.getState = function() {
	return this._state;
};


/**
 * Return the audioContext initialised and used by the recorder.
 *
 * see https://developer.mozilla.org/fr/docs/Web/API/AudioContext
 *
 * @return {AudioContext} The AudioContext object used by the recorder.
 */
LinguaRecorder.prototype.getAudioContext = function() {
	return this.audioContext;
};


/**
 * Start to record.
 *
 * If autoStart is set to true, enter in listening state and postpone the start
 * of the recording when a voice will be detected.
 *
 * @chainable
 */
LinguaRecorder.prototype.start = function() {
	return this._sendCommandToProcessor( 'start' );
};


/**
 * Switch the record to the pause state.
 *
 * While in pause, all the inputs comming from the microphone will be ignored.
 * To resume to the recording state, just call the start() method again.
 * It is also still possible to stop() or cancel() a record,
 * and you have to do so upstream if you wish to start a new one.
 *
 * @chainable
 */
LinguaRecorder.prototype.pause = function() {
	return this._sendCommandToProcessor( 'pause' );
};


/**
 * Stop the recording process and fire the record to the user.
 *
 * Depending of the configuration, this method could discard the record
 * if it fails some quality controls (duration and saturation).
 *
 * To start a new record afterwards, just call the start() method again.
 *
 * @chainable
 */
LinguaRecorder.prototype.stop = function( cancelRecord ) {
	return this._sendCommandToProcessor( 'stop' );
};


/**
 * Stop a recording, but without saving the record.
 * @chainable
 */
LinguaRecorder.prototype.cancel = function() {
	return this._sendCommandToProcessor( 'cancel' );
};


/**
 * Toggle between the recording and stopped state.
 * @chainable
 */
LinguaRecorder.prototype.toggle = function() {
	return this._sendCommandToProcessor( 'toggle' );
};


/**
 * Attach a handler function to a given event.
 *
 * @param {string} [event] Name of an event.
 * @param {function} [handler] A function to execute when the event is triggered.
 * @chainable
 */
LinguaRecorder.prototype.on = function( event, handler ) {
	if ( event in this._eventHandlers ) {
		this._eventHandlers[ event ].push( handler );
	}

	// For one-time events, re-fire it if it already occured
	if ( event in this._eventStorage && this._eventStorage[ event ] !== null ) {
		handler( this._eventStorage[ event ] );
	}

	return this;
};


/**
 * Remove all the handler function from an event.
 *
 * @param {string} [event] Name of an event.
 * @chainable
 */
LinguaRecorder.prototype.off = function( event ) {
	if ( event in this._eventHandlers ) {
		this._eventHandlers[ event ] = [];
	}

	return this;
};


/**
 * Add an extra AudioNode
 *
 * This can be used to draw a live visualisation of the sound, or to perform
 * some live editing tasks on the stream before it is recorded.
 *
 * Note that it can produce a little interrupt in the record if you are in
 * listening or recording state.
 *
 * @param {AudioNode} [node] Node to connect inside the recording context.
 * @chainable
 */
LinguaRecorder.prototype.connectAudioNode = function( node ) {
	//TODO: update this
	if ( this._state === STATE.listening || this._state === STATE.recording ) {
		this._disconnect();
	}
	this._extraAudioNodes.push( node );
	if ( this._state === STATE.listening || this._state === STATE.recording ) {
		this._connect();
	}
	return this;
};


/**
 * Remove an extra AudioNode
 *
 * Note that it can produce a little interrupt in the record if you are in
 * listening or recording state.
 *
 * @param {AudioNode} [node] Node to disconnect from the recording context.
 * @chainable
 */
LinguaRecorder.prototype.disconnectAudioNode = function( node ) {
	//TODO: update this
	for ( var i = 0; i < this._extraAudioNodes.length; i++ ) {
		if ( node === this._extraAudioNodes[ i ] ) {
			if ( this._state === STATE.listening || this._state === STATE.recording ) {
				this._disconnect();
			}
			this._extraAudioNodes.splice( i, 1 );
			if ( this._state === STATE.listening || this._state === STATE.recording ) {
				this._connect();
			}
			break;
		}
	}

	return this;
};


/**
 * Send a message to the Recording Processor to change it's behaviour.
 * 
 * @param {string} [command] Name of the command to send.
 * @chainable
 */
LinguaRecorder.prototype._sendCommandToProcessor = function( command ) {
	if ( this.processor !== undefined ) {
		this.processor.port.postMessage( { message: command } );
	}
	return this;
};


/**
 * Fire a give event to all the registred handlers functions.
 *
 * For one-time events (ready, readyFail), stores the firered value
 * to be able to re-fire it for listners that are registered later
 *
 * @param {string} [event] Name of the event to fire.
 * @return {Object|Array|string|undefined} [value] Bounds if valid.
 * @private
 */
LinguaRecorder.prototype._fire = function( event, value ) {
	if ( event in this._eventHandlers ) {
		for ( var i=0; i<this._eventHandlers[ event ].length; i++ ) {
			this._eventHandlers[ event ][ i ]( value );
		}
	}

	if ( event in this._eventStorage ) {
		this._eventStorage[ event ] = value;
	}
};


/**
 * First step to initialise the LinguaRecorder object. Try to get a MediaStream object
 * with tracks containing an audio input from the microphone of the user.
 *
 * Note that it will prompt a notification requesting permission from the user.
 * Furthermore, modern browsers requires the use of HTTPS to allow it.
 *
 * for more details: https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getUserMedia
 *
 * @private
 */
LinguaRecorder.prototype._getAudioStream = function() {
	var recorder = this;

	// Current best practice to get the audio stream according to the specs
	navigator.mediaDevices.getUserMedia({audio: true, video:false})
	.then(function(localMediaStream) {
		recorder.stream = localMediaStream;
		recorder._initStream();
		recorder._fire( 'ready', localMediaStream );
	} ).catch(function(err) {
		recorder._fire( 'readyFail', err );
	} );
};


/**
 * Called once we got a MediaStream. Create an AudioContext and
 * some needed AudioNode.
 *
 * for more details: https://developer.mozilla.org/fr/docs/Web/API/AudioNode
 *
 * @private
 */
LinguaRecorder.prototype._initStream = function() {
	var recorder = this;

	this.audioContext = new window.AudioContext();
	this.audioInput = this.audioContext.createMediaStreamSource( this.stream );

	this.recordProcessorConfig.sampleRate = this.audioContext.sampleRate;
	this.audioContext.audioWorklet.addModule('../src/RecordingProcessor.js').then(() => { //TODO: use async/await as support of older browsers is not an issue anymore
		this.processor = new AudioWorkletNode( this.audioContext, 'recording-processor', { processorOptions: this.recordProcessorConfig } ); //TODO: include a polify for older browsers?

		this.audioInput.connect( this.processor );
		
		this.processor.port.onmessage = (event) => {
			console.log("LR:", event.data.message)
			switch (event.data.message) {
				case 'started':
					this._state = STATE.recording;
					this._fire( 'started' );
					break;
				case 'listening':
					this._state = STATE.listening;
					this._fire( 'listening', event.data.samples );
					break;
				case 'recording':
					this._state = STATE.recording;
					this._fire( 'recording', event.data.samples );
					break;
				case 'saturated':
					this._fire( 'saturated' );
					break;
				case 'paused':
					this._state = STATE.paused;
					this._fire( 'paused' );
					break;
				case 'stoped':
					this._state = STATE.stop;
					var audioRecord = new AudioRecord( event.data.record, this.audioContext.sampleRate )
					this._fire( 'stoped', audioRecord );
					break;
				case 'canceled':
					this._state = STATE.stop;
					this._fire( 'canceled', event.data.reason );
					break;
			}
		};
	} );
};


/**
 * Connect the audioInput node to a processor node, choosen depending of the
 * current state of the recorder.
 *
 * If some AudioNodes are set through the connectAudioNode() method,
 * it connect them also in between.
 *
 * @private
 */
LinguaRecorder.prototype._connect = function() {
	//TODO: update this

	var currentNode = this.audioInput;
	for ( var i=0; i < this._extraAudioNodes.length; i++ ) {
		currentNode.connect( this._extraAudioNodes[ i ] );
		currentNode = this._extraAudioNodes[ i ];
	}
}


/**
 * Disconnect the audioInput node from the currently connected processor node.
 *
 * @private
 */
LinguaRecorder.prototype._disconnect = function() {
	//TODO: update this
	for ( var i=0; i < this._extraAudioNodes.length; i++ ) {
		this._extraAudioNodes[ i ].disconnect();
	}
}




