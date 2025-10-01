# Audio Transcription Feature

This document describes the audio transcription functionality added to the VS Code OpenAI Agent extension.

## Overview

The extension now supports transcribing audio files (MP3 and MP4) using OpenAI's Whisper API. Users can upload audio files and get them automatically transcribed into text, which is then added to the chat context.

## Features

- **Supported Formats**: MP3 and MP4 audio files
- **File Size Limit**: 25MB maximum (OpenAI API limitation)
- **Language Support**: Auto-detection or manual language specification
- **Integration**: Seamlessly integrated with existing chat functionality
- **Configuration**: Configurable default language for transcription

## How to Use

1. Open the OpenAI Agent chat panel in VS Code
2. Click the microphone button (🎤 icon) next to the audio upload button
3. Select an MP3 or MP4 file from your computer
4. Enter the language code for transcription (e.g., 'ru' for Russian, 'en' for English) or leave empty for auto-detection
5. The file will be transcribed and the text will be added to the chat context
6. You can now ask questions about the transcribed content

## Technical Implementation

### Frontend (Webview)
- Added transcription button to the chat interface HTML
- Implemented file selection and validation in JavaScript
- Added language prompt for transcription
- Added base64 encoding for file transmission to the extension

### Backend (Extension)
- Extended `OpenAIServiceInterface` with `transcribeAudio` method
- Implemented audio transcription in `OpenAIChatService` using Whisper API
- Added transcription message handling in `ChatViewProvider`
- Integrated with RAG system for audio file storage

### Configuration
- Added language configuration option in `package.json`
- Configurable default language for transcription
- Language setting is passed to the frontend on initialization

## Configuration Options

The following configuration options are available in VS Code settings:

- `openaiAgent.audio.transcriptionLanguage`: Default language for audio transcription (e.g., 'ru', 'en', 'es'). Leave empty for auto-detection

## API Integration

The feature uses OpenAI's Whisper API for transcription:
- **Endpoint**: `https://api.openai.com/v1/audio/transcriptions`
- **Model**: `whisper-1`
- **Supported Languages**: All languages supported by Whisper
- **File Processing**: Temporary file creation and cleanup

## Error Handling

- File type validation with user-friendly error messages
- File size validation with clear size limits
- Graceful error handling for transcription failures
- Proper error messages displayed in the chat interface
- Temporary file cleanup on both success and failure

## Usage Examples

### Basic Transcription
1. Click the microphone button
2. Select an audio file
3. Leave language field empty for auto-detection
4. Get transcribed text in chat

### Language-Specific Transcription
1. Click the microphone button
2. Select an audio file
3. Enter language code (e.g., 'ru' for Russian)
4. Get transcribed text in the specified language

### Using Default Language
1. Set `openaiAgent.audio.transcriptionLanguage` in VS Code settings
2. Click the microphone button
3. Select an audio file
4. The default language will be used automatically

## Future Enhancements

Potential future improvements could include:
- Batch audio file transcription
- Audio playback controls in the chat interface
- Transcription confidence scores
- Support for additional audio formats
- Real-time audio transcription
- Translation of transcribed text

## Dependencies

The implementation uses:
- `form-data` package for multipart form data submission to Whisper API
- Native HTML5 File API for file selection
- Base64 encoding for file transmission
- Existing VS Code extension APIs
- Current OpenAI service architecture

## Troubleshooting

### Common Issues

1. **Transcription fails**: Check that your OpenAI API key has access to the Whisper API
2. **File too large**: Ensure audio files are under 25MB
3. **Unsupported format**: Use MP3 or MP4 files only
4. **Language not recognized**: Use standard language codes (e.g., 'ru', 'en', 'es')

### Debug Information

- Check the VS Code Developer Console for detailed error messages
- Verify API key permissions in OpenAI dashboard
- Ensure stable internet connection for API calls
