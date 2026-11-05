// The deal panel opens over the board (intercepting route @panel/(.)deal/[id]).
export default function PipelineLayout({ children, panel }: LayoutProps<"/pipeline">) {
  return (
    <>
      {children}
      {panel}
    </>
  );
}
