import { useNavigate } from 'react-router-dom';
import { CATEGORIES } from '../utils/constants';

export default function CategoryGrid() {
  const navigate = useNavigate();
  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
      {CATEGORIES.map((cat) => (
        <button
          key={cat.value}
          onClick={() => navigate(`/search?category=${cat.value}`)}
          className="ticket p-4 flex flex-col items-center gap-2 hover:shadow-md hover:-translate-y-0.5 transition-all"
        >
          <span className="text-3xl">{cat.emoji}</span>
          <span className="text-sm font-medium text-ink text-center">{cat.label}</span>
        </button>
      ))}
    </div>
  );
}
