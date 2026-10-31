/** Decorative clay study objects, built in CSS without image or font requests. */
export default function StudyScene(){
  return <div className="study-scene" aria-hidden="true">
    <div className="scene-ground"/>
    <div className="scene-moon"/>
    <div className="scene-lamp"><span className="lamp-foot"/><span className="lamp-stem"/><span className="lamp-arm"/><span className="lamp-shade"/></div>
    <div className="scene-book"><span className="book-cover"/><span className="book-page page-left"><i/><i/><i/></span><span className="book-page page-right"><i/><i/><i/></span><span className="book-spine"/><span className="book-ribbon"/></div>
    <div className="scene-pencil"/>
  </div>;
}
