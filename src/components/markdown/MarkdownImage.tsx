import { memo, useEffect, useState } from "react"
import { ActivityIndicator, Image, ImageBackground, type ImageStyle } from "react-native"

interface Props {
  uri: string
  alt?: string
  style?: ImageStyle
}

// App-owned replacement for react-native-marked's MDImage (see CustomRenderer
// in Markdown.tsx).
//
// The library's version fetches the image size in an effect with NO dependency
// array:
//
//   useEffect(() => { fetchOriginalSizeFromRemoteImage() })
//
// so it refetches after every render, and both callbacks call setState with a
// fresh object — a self-sustaining loop for any markdown image. Every render
// also asks the renderer for new React keys, and the library's keys come from
// github-slugger, which stores one property per call: past 196,607 the Hermes
// object limit throws and the session screen dies. Scoping the fetch to [uri]
// leaves two renders per image.
function MarkdownImageInner({ uri, alt, style }: Props) {
  const [imageState, setImageState] = useState({ isLoading: true, aspectRatio: undefined as number | undefined })

  useEffect(() => {
    Image.getSize(
      uri,
      (width, height) => {
        setImageState({ isLoading: false, aspectRatio: width > 0 && height > 0 ? width / height : undefined })
      },
      () => {
        setImageState((current) => ({ ...current, isLoading: false }))
      },
    )
  }, [uri])

  return (
    <ImageBackground
      source={{ uri }}
      style={{ width: "100%", aspectRatio: imageState.aspectRatio }}
      accessibilityRole="image"
      accessibilityLabel={alt}
      imageStyle={style}
      testID="react-native-marked-md-image"
    >
      {imageState.isLoading ? (
        <ActivityIndicator testID="react-native-marked-md-image-activity-indicator" size="small" />
      ) : null}
    </ImageBackground>
  )
}

export const MarkdownImage = memo(MarkdownImageInner)
