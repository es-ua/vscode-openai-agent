# Audio Upload Feature

This document describes the audio upload functionality added to the VS Code OpenAI Agent extension.

## Overview

The extension now supports uploading audio files (MP3 and MP4) directly in the chat interface. Users can upload audio files to share with the AI assistant for analysis, transcription, or other audio-related tasks.

## Features

- **Supported Formats**: MP3 and MP4 audio files
- **File Size Limit**: 25MB maximum (OpenAI API limitation)
- **Upload Method**: Click the audio upload button in the chat interface
- **File Validation**: Automatic validation of file type and size
- **Integration**: Seamlessly integrated with existing chat functionality

## How to Use

1. Open the OpenAI Agent chat panel in VS Code
2. Click the audio upload button (🎵 icon) next to the image upload button
3. Select an MP3 or MP4 file from your computer
4. The file will be uploaded and added to the chat context
5. The AI assistant can now process and respond to the audio content

## Technical Implementation

### Frontend (Webview)
- Added audio upload button to the chat interface HTML
- Implemented file selection and validation in JavaScript
- Added base64 encoding for file transmission to the extension

### Backend (Extension)
- Extended `OpenAIServiceInterface` with `addAudio` method
- Implemented audio processing in `OpenAIChatService`
- Added audio message handling in `ChatViewProvider`
- Integrated with RAG system for audio file storage

### Configuration
- Added audio file size and type configuration options in `package.json`
- Configurable maximum file size (default: 25MB)
- Configurable allowed MIME types

## Configuration Options

The following configuration options are available in VS Code settings:

- `openaiAgent.audio.maxFileSize`: Maximum audio file size in bytes (default: 26214400 = 25MB)
- `openaiAgent.audio.allowedTypes`: Array of allowed MIME types (default: ["audio/mp3", "audio/mpeg", "audio/mp4", "video/mp4"])

## Error Handling

- File type validation with user-friendly error messages
- File size validation with clear size limits
- Graceful error handling for upload failures
- Proper error messages displayed in the chat interface

## Future Enhancements

Potential future improvements could include:
- Audio transcription using OpenAI's Whisper API
- Audio analysis and insights
- Support for additional audio formats
- Audio playback controls in the chat interface
- Batch audio file uploads

## Dependencies

No additional dependencies were required for this feature. The implementation uses:
- Native HTML5 File API for file selection
- Base64 encoding for file transmission
- Existing VS Code extension APIs
- Current OpenAI service architecture
