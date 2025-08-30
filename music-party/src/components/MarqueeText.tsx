import { Box, BoxProps } from "@chakra-ui/react";
import { keyframes } from "@emotion/react";
import React, { useState, useRef, useEffect, ReactNode } from "react";

// Interface for component props, now includes a fixed pause duration
interface MarqueeTextProps extends BoxProps {
  children: ReactNode;
  speed?: number; // pixels per second
  pauseInSeconds?: number; // seconds to pause at each end
}

export const MarqueeText: React.FC<MarqueeTextProps> = ({ children, speed = 50, pauseInSeconds = 5, ...rest }) => {
  // state now holds the string for the animation property
  const [animation, setAnimation] = useState<string | undefined>(undefined);
  const containerRef = useRef<HTMLDivElement>(null);
  const textRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const calculateAnimation = () => {
      if (containerRef.current && textRef.current) {
        const containerWidth = containerRef.current.offsetWidth;
        const textWidth = textRef.current.scrollWidth;
        const isOverflowing = textWidth > containerWidth;

        if (isOverflowing) {
          const offset = containerWidth - textWidth; // negative value
          const scrollDuration = Math.abs(offset) / speed;
          
          // [修正] Total duration is now the scroll time plus two fixed pauses
          const totalDuration = scrollDuration + (pauseInSeconds * 2);
          // [修正] Calculate the percentage of time for the initial pause based on the fixed duration
          const pausePercent = (pauseInSeconds / totalDuration) * 100;
          const scrollEndPercent = ((pauseInSeconds + scrollDuration) / totalDuration) * 100;

          // [修正] Dynamically create keyframes with calculated percentages for precise control
          const dynamicMarquee = keyframes`
            0% { transform: translateX(0); }
            ${pausePercent}% { transform: translateX(0); }
            ${scrollEndPercent}% { transform: translateX(${offset}px); }
            100% { transform: translateX(${offset}px); }
          `;
          
          setAnimation(`${dynamicMarquee} ${totalDuration}s linear infinite`);
        } else {
          // If not overflowing, remove the animation
          setAnimation(undefined);
        }
      }
    };

    const resizeObserver = new ResizeObserver(calculateAnimation);
    if (containerRef.current) {
      resizeObserver.observe(containerRef.current);
    }
    
    calculateAnimation();
    
    return () => {
      if (containerRef.current) {
        // eslint-disable-next-line react-hooks/exhaustive-deps
        resizeObserver.unobserve(containerRef.current);
      }
    };
  }, [children, speed, pauseInSeconds]);
  
  return (
    <Box
      ref={containerRef}
      w="100%"
      overflow="hidden"
      whiteSpace="nowrap"
      position="relative"
      {...rest}
    >
      <Box
        ref={textRef}
        display="inline-block"
        // [修正] Directly apply the calculated animation state
        animation={animation}
      >
        {children}
      </Box>
    </Box>
  );
};

