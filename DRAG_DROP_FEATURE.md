# Drag & Drop Feature

This document describes the drag & drop functionality added to the VS Code OpenAI Agent extension for audio files.

## Overview

The extension now supports dragging and dropping audio files directly into the chat interface. This provides a more intuitive and user-friendly way to upload and transcribe audio files compared to using the file selection buttons.

## Features

- **Drag & Drop Support**: Drag audio files directly into the chat area
- **Visual Feedback**: Beautiful overlay with animation when dragging files
- **Dual Mode Selection**: Choose between simple upload or transcription
- **File Validation**: Automatic validation of file type and size
- **Responsive Design**: Works on both desktop and mobile interfaces

## How to Use

### Basic Drag & Drop
1. Open the OpenAI Agent chat panel in VS Code
2. Drag an MP3 or MP4 file from your file explorer
3. Drop it anywhere in the chat area
4. A beautiful overlay will appear with two options:
   - 🎵 **Upload Audio** - Simply upload the file
   - 🎤 **Transcribe Audio** - Upload and transcribe the file

### Visual Interface
- **Overlay**: Semi-transparent overlay with blur effect
- **Icons**: Large, clickable icons for each action
- **Animation**: Smooth hover effects and transitions
- **Responsive**: Adapts to different screen sizes

## Technical Implementation

### Frontend (Webview)
- Added drag & drop event listeners to the main app container
- Implemented visual overlay with HTML/CSS
- Added file validation and processing logic
- Created smooth animations and transitions

### Backend (Extension)
- Reuses existing audio upload and transcription services
- No additional backend changes required
- Maintains all existing functionality

### CSS Styling
- Modern overlay design with backdrop blur
- Smooth animations and hover effects
- Responsive design for mobile devices
- VS Code theme integration

## Supported File Types

- ✅ **MP3** (.mp3)
- ✅ **MP4** (.mp4)
- ✅ **M4A** (via MP4)
- ❌ WAV, FLAC, OGG (not supported)

## File Size Limits

- **Maximum Size**: 25MB (OpenAI API limitation)
- **Validation**: Automatic size checking with user-friendly error messages
- **Error Handling**: Clear feedback for oversized files

## User Experience

### Visual Feedback
1. **Drag Enter**: Overlay appears with animation
2. **Drag Over**: Smooth visual feedback
3. **Drag Leave**: Overlay disappears if leaving the area
4. **Drop**: File processing begins immediately

### Error Handling
- **Invalid File Type**: Clear error message with supported formats
- **File Too Large**: Size limit warning with maximum allowed size
- **Processing Errors**: Graceful error handling with user feedback

## Responsive Design

### Desktop
- Full-size overlay with large icons
- Smooth animations and hover effects
- Professional appearance

### Mobile/Tablet
- Smaller overlay with adjusted icon sizes
- Touch-friendly interface
- Optimized for smaller screens

## Integration with Existing Features

### Audio Upload
- Uses existing `uploadAudio` functionality
- Maintains all current features
- No changes to backend processing

### Audio Transcription
- Uses existing `transcribeAudio` functionality
- Supports language selection
- Maintains all current features

## CSS Classes

### Main Overlay
- `#drag-drop-overlay` - Main overlay container
- `#drag-drop-content` - Content area with styling
- `#drag-drop-icon` - Clickable action icons
- `#drag-drop-text` - Descriptive text
- `#drag-drop-subtext` - Additional instructions

### Animations
- `dragPulse` - Subtle pulsing animation
- `transform: scale()` - Hover effects
- `transition` - Smooth state changes

## Browser Compatibility

- **Modern Browsers**: Full support for all features
- **File API**: Uses standard HTML5 File API
- **Drag & Drop API**: Native browser drag & drop support
- **CSS Features**: Modern CSS with fallbacks

## Performance Considerations

- **Lightweight**: Minimal performance impact
- **Event Delegation**: Efficient event handling
- **Memory Management**: Proper cleanup of temporary files
- **Animation Optimization**: Hardware-accelerated animations

## Future Enhancements

Potential future improvements could include:
- **Multiple File Support**: Drag multiple files at once
- **File Preview**: Show file information before processing
- **Progress Indicators**: Visual feedback during processing
- **Keyboard Shortcuts**: Alternative input methods
- **Custom Drop Zones**: Specific areas for different actions

## Troubleshooting

### Common Issues

1. **Drag & Drop Not Working**:
   - Ensure you're dragging from a file explorer
   - Check that the file is a supported format
   - Verify the file size is under 25MB

2. **Overlay Not Appearing**:
   - Check browser console for JavaScript errors
   - Ensure the extension is properly loaded
   - Try refreshing the webview

3. **File Processing Fails**:
   - Verify OpenAI API key is set
   - Check internet connection
   - Ensure file format is supported

### Debug Information

- Check VS Code Developer Console for detailed error messages
- Verify file type and size before dragging
- Ensure stable internet connection for API calls

## Accessibility

- **Keyboard Navigation**: Overlay can be dismissed with Escape key
- **Screen Readers**: Proper ARIA labels and descriptions
- **High Contrast**: Compatible with VS Code themes
- **Focus Management**: Proper focus handling for accessibility

## Security Considerations

- **File Validation**: Strict file type and size validation
- **No Local Storage**: Files are processed immediately
- **API Security**: Uses existing secure API endpoints
- **User Privacy**: No file data is stored locally
