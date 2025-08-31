import { Box, BoxProps } from "@chakra-ui/react";
import { keyframes } from "@emotion/react";
import React, { useState, useRef, useEffect, ReactNode } from "react";

// 定义组件的 props 接口
interface MarqueeTextProps extends BoxProps {
  children: ReactNode;
  speed?: number; // 滚动速度，单位是 像素/秒
  startPauseInSeconds?: number; // 开始滚动前，在起点停留的时长（秒）
  endPauseInSeconds?: number;   // 滚动结束后，在终点停留的时长（秒）
}

export const MarqueeText: React.FC<MarqueeTextProps> = ({ 
  children, 
  speed = 50,
  startPauseInSeconds = 2, 
  endPauseInSeconds = 2,
  ...rest 
}) => {
  // 这个 state 用来存储最终生成的 CSS 动画属性
  const [animation, setAnimation] = useState<string | undefined>(undefined);
  
  // 使用 ref 来获取 DOM 元素的引用，以便测量它们的宽度
  const containerRef = useRef<HTMLDivElement>(null); // 外层容器
  const textRef = useRef<HTMLDivElement>(null);      // 内层文字

  useEffect(() => {
    // 定义一个函数来计算并生成动画
    const calculateAnimation = () => {
      // 确保元素已经渲染到页面上
      if (containerRef.current && textRef.current) {
        const containerWidth = containerRef.current.offsetWidth; // 容器的宽度
        const textWidth = textRef.current.scrollWidth;         // 文字的实际总宽度
        
        // 判断文字宽度是否超出了容器宽度，只有超出的情况下才需要滚动
        const isOverflowing = textWidth > containerWidth;

        if (isOverflowing) {
          // 1. 计算滚动的距离 (这是一个负数)
          const offset = containerWidth - textWidth;
          // 2. 根据距离和速度，计算滚动需要花费的时间
          const scrollDuration = Math.abs(offset) / speed;
          
          // 3. 计算动画的总时长 = 开始停留 + 滚动时长 + 结束停留
          const totalDuration = startPauseInSeconds + scrollDuration + endPauseInSeconds;

          // 4. 计算动画关键帧（keyframes）的时间节点百分比
          //    - 开始停留在 0% -> pausePercent %
          //    - 滚动过程在 pausePercent % -> scrollEndPercent %
          //    - 结束停留在 scrollEndPercent % -> 100%
          const pausePercent = (startPauseInSeconds / totalDuration) * 100;
          const scrollEndPercent = ((startPauseInSeconds + scrollDuration) / totalDuration) * 100;

          // 5. 动态创建 CSS 关键帧动画
          const dynamicMarquee = keyframes`
            0% { transform: translateX(0); } /* 动画开始，在原点 */
            ${pausePercent}% { transform: translateX(0); } /* 到达这个百分比时，依然在原点，实现开始停留 */
            ${scrollEndPercent}% { transform: translateX(${offset}px); } /* 到达这个百分比时，移动到终点，实现滚动 */
            100% { transform: translateX(${offset}px); } /* 动画结束，依然在终点，实现结束停留 */
          `;
          
          // 6. 将动画应用到 state 中
          setAnimation(`${dynamicMarquee} ${totalDuration}s linear infinite`);
        } else {
          // 如果文字没有超出，就不需要动画
          setAnimation(undefined);
        }
      }
    };

    // 监听容器尺寸变化，如果变化了就重新计算动画
    const resizeObserver = new ResizeObserver(calculateAnimation);
    if (containerRef.current) {
      resizeObserver.observe(containerRef.current);
    }
    
    // 首次渲染时计算一次动画
    calculateAnimation();
    
    // 组件卸载时，停止监听，清理资源
    return () => {
      if (containerRef.current) {
        // eslint-disable-next-line react-hooks/exhaustive-deps
        resizeObserver.unobserve(containerRef.current);
      }
    };
  }, [children, speed, startPauseInSeconds, endPauseInSeconds]);
  
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
        // 直接应用我们计算好的 animation state
        animation={animation}
      >
        {children}
      </Box>
    </Box>
  );
};
