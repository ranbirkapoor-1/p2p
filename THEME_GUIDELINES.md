# Theme Consistency Guidelines

## Core Philosophy
**Function First, Consistent Form Second**

While functionality always takes precedence, maintaining visual consistency enhances user experience and reduces cognitive load. A consistent theme makes the application feel professional and trustworthy, even in early development stages.

## Color Palette

### Primary Colors
- **Background Dark**: `#1a1a1a` - Main app background
- **Background Light**: `#1e1e1e` - Header and elevated surfaces
- **Surface**: `#2a2a2a` - Cards, modals, input backgrounds

### Accent Colors
- **Primary Blue**: `#007acc` - Primary actions, links
- **Primary Purple**: `#667eea` to `#764ba2` - Gradients for special buttons
- **Success Green**: `#4ecdc4` - Connected states, success messages
- **Warning Yellow**: `#ffd93d` - Connecting states, warnings
- **Danger Red**: `#ff4757` - Disconnected states, end call buttons

### Text Colors
- **Primary Text**: `#ffffff` - Main content
- **Secondary Text**: `#a8a8b3` - Subtle text, descriptions
- **Muted Text**: `#666666` - Version info, timestamps

## Typography

### Font Stack
```css
font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, sans-serif;
```

### Monospace (for code/version)
```css
font-family: 'SF Mono', 'Monaco', 'Inconsolata', monospace;
```

### Font Sizes
- **Headers**: 24px (h2), 20px (h3)
- **Body**: 14px
- **Small**: 12px
- **Tiny**: 11px (version, timestamps)

## Spacing System

Use consistent spacing multiples:
- **Base unit**: 4px
- **Common spacings**: 8px, 12px, 16px, 20px, 24px, 32px
- **Padding**: 12px (small), 16px (medium), 20px (large)
- **Margins**: Follow same scale

## Component Patterns

### Buttons
```css
/* Primary Button */
background: #007acc;
color: white;
padding: 10px 20px;
border-radius: 6px;
border: none;
transition: background 0.2s ease;

/* Hover */
background: #005a9e;
```

### Inputs
```css
background: #2a2a2a;
border: 1px solid #3e3e42;
color: #ffffff;
padding: 10px;
border-radius: 6px;
```

### Cards/Modals
```css
background: #2a2a2a;
border-radius: 12px;
box-shadow: 0 4px 6px rgba(0, 0, 0, 0.3);
padding: 20px;
```

## Status Indicators

### Connection States
- **Connected**: Green dot with glow `#4ecdc4`
- **Connecting**: Yellow dot pulsing `#ffd93d`
- **Disconnected**: Red dot `#ff4757`
- **Paused**: Gray dots with slow pulse

### Speaking/Activity
- **Speaking**: Blue glow animation
- **Muted**: Reduced opacity (0.6)
- **Active**: Bright accent color

## Animations

### Standard Transitions
```css
transition: all 0.2s ease;  /* Quick interactions */
transition: all 0.3s ease;  /* Standard transitions */
transition: all 0.5s ease;  /* Smooth state changes */
```

### Common Animations
- **Pulse**: For attention/activity
- **Fade**: For appearance/disappearance
- **Slide**: For panels/modals

## Dark Mode Best Practices

1. **Avoid Pure Black**: Use `#1a1a1a` instead of `#000000`
2. **Elevation with Lightness**: Higher surfaces should be slightly lighter
3. **Contrast Ratios**: Maintain WCAG AA standards (4.5:1 for normal text)
4. **Reduce Eye Strain**: Lower contrast for long reading sessions

## Responsive Design

### Breakpoints
- **Mobile**: < 768px
- **Tablet**: 768px - 1024px
- **Desktop**: > 1024px

### Scaling
- Use relative units (rem, em, %) where appropriate
- Maintain touch targets of at least 44x44px on mobile
- Scale spacing proportionally

## Icon Guidelines

### Style
- Use SVG icons for scalability
- Consistent stroke width (2px)
- Simple, recognizable shapes
- Match text color for consistency

### Common Icons
- **Phone**: Audio call
- **Video**: Video call
- **Users**: Group call
- **Mic/Mic-off**: Mute states
- **X**: Close/end/reject

## Implementation Checklist

When adding new UI elements:

- [ ] Use colors from defined palette
- [ ] Apply consistent spacing (multiples of 4px)
- [ ] Match existing border radius patterns
- [ ] Include hover/active states
- [ ] Add smooth transitions
- [ ] Test in dark environment
- [ ] Verify contrast ratios
- [ ] Check responsive behavior

## CSS Organization

### File Structure
- `style.css` - Core application styles
- `call-styles.css` - Call-specific UI
- `group-call-styles.css` - Group call features
- `file-styles.css` - File transfer UI

### Naming Conventions
- Use descriptive class names
- Follow BEM for complex components
- Prefix with feature name for isolation

## Future Considerations

While maintaining current functionality:
1. Consider CSS variables for theme switching
2. Plan for accessibility improvements
3. Prepare for light mode option
4. Consider user preference persistence

## Remember

> "Consistency reduces cognitive load. When users know what to expect, they can focus on communication rather than learning the interface."

Every visual decision should support the primary goal: reliable, real-time P2P communication. The theme should be invisible when working well - users shouldn't think about it, just use it.